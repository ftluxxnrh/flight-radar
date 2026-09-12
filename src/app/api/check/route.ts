import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { alerts, checks, flightSnapshots } from "@/db/schema";
import { AIRPORTS, depHour, searchNaverFlights, type NaverFlight } from "@/lib/naver";
import {
  buildAlertKey,
  buildSeatAlertMessage,
  getTelegramConfig,
  sendTelegramMessage,
  type AlertFlight,
} from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{8}$/;

/** 같은 좌석 목록은 이 시간 동안 다시 알리지 않는다 (목록이 바뀌면 즉시 재알림) */
const AUTO_ALERT_COOLDOWN_MS = 30 * 60 * 1000;

/* DB가 없는 환경(로컬 등)을 위한 메모리 기반 중복 방지 캐시 */
const memo = globalThis as typeof globalThis & {
  __seatAlertMemo?: Record<string, { key: string; at: number }>;
};

export interface AutoAlertResult {
  sent: boolean;
  skipped: string | null;
  detail: string;
}

/**
 * 좌석 발견 시 텔레그램으로 "자동" 알림을 보낸다.
 * - 동일 좌석 목록이 유지되면 30분간 재발송하지 않는다.
 * - 목록 구성이 바뀌면(새 취소표 등장) 즉시 다시 보낸다.
 */
async function maybeAutoAlert(
  dep: string,
  arr: string,
  depDate: string,
  targets: NaverFlight[],
): Promise<AutoAlertResult> {
  const cfg = await getTelegramConfig();
  if (!cfg.configured) {
    return {
      sent: false,
      skipped: "not-configured",
      detail: `텔레그램 미설정 — 서버 환경변수 ${cfg.missing.join(", ")} 필요`,
    };
  }

  const flights: AlertFlight[] = targets.map((f) => ({
    airlineName: f.airlineName,
    flightNo: f.flightNo,
    depTime: f.depTime,
    minFare: f.minFare,
  }));
  const key = buildAlertKey(flights);
  const memoKey = `${dep}-${depDate}`;

  /* 중복 방지: 마지막으로 보낸 알림과 좌석 목록이 같으면 건너뜀 */
  let lastKey: string | null = null;
  let lastAt = 0;
  if (db) {
    try {
      const rows = await db
        .select()
        .from(alerts)
        .where(
          and(
            eq(alerts.kind, "seat_found"),
            eq(alerts.dep, dep),
            eq(alerts.depDate, depDate),
          ),
        )
        .orderBy(desc(alerts.createdAt))
        .limit(1);
      const last = rows[0];
      if (last) {
        lastKey = last.alertKey;
        lastAt = last.createdAt.getTime();
      }
    } catch {
      /* 조회 실패 시 발송을 막지 않는다 */
    }
  } else {
    const m = memo.__seatAlertMemo?.[memoKey];
    if (m) {
      lastKey = m.key;
      lastAt = m.at;
    }
  }

  if (lastKey === key && Date.now() - lastAt < AUTO_ALERT_COOLDOWN_MS) {
    return { sent: false, skipped: "unchanged", detail: "동일 좌석 유지 — 중복 알림 생략" };
  }

  const message = buildSeatAlertMessage(dep, arr, depDate, flights);
  const result = await sendTelegramMessage(message);

  /* 발송 기록 저장 */
  if (db) {
    try {
      await db.insert(alerts).values({
        kind: "seat_found",
        dep,
        arr,
        depDate,
        message,
        sentOk: result.ok,
        detail: result.detail,
        alertKey: key,
      });
    } catch {
      /* 기록 실패해도 알림 자체는 성공 처리 */
    }
  }
  memo.__seatAlertMemo = {
    ...(memo.__seatAlertMemo ?? {}),
    [memoKey]: { key, at: Date.now() },
  };

  return {
    sent: result.ok,
    skipped: result.ok ? null : "send-failed",
    detail: result.detail,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const dep = (url.searchParams.get("dep") ?? "").toUpperCase();
  const arr = (url.searchParams.get("arr") ?? "").toUpperCase();
  const date = url.searchParams.get("date") ?? "";
  const maxHour = Math.min(
    24,
    Math.max(0, Number(url.searchParams.get("maxHour") ?? "13")),
  );
  const persist = url.searchParams.get("persist") !== "0";

  if (!AIRPORTS[dep] || !AIRPORTS[arr] || !DATE_RE.test(date)) {
    return NextResponse.json(
      { error: "파라미터 오류 — dep/arr은 국내 공항코드, date는 YYYYMMDD 형식이어야 합니다." },
      { status: 400 },
    );
  }

  const started = Date.now();
  const result = await searchNaverFlights(dep, arr, date);
  const durationMs = Date.now() - started;

  const targets = result.flights.filter((f) => depHour(f.depTime) < maxHour);
  const minFare =
    result.flights.length > 0
      ? Math.min(...result.flights.map((f) => f.minFare || Number.MAX_SAFE_INTEGER))
      : null;

  let checkId: number | null = null;
  if (persist && db) {
    try {
      const inserted = await db
        .insert(checks)
        .values({
          dep,
          arr,
          depDate: date,
          status: result.ok ? "ok" : "error",
          totalFlights: result.flights.length,
          targetCount: targets.length,
          minFare,
          durationMs,
          error: result.error ?? null,
        })
        .returning({ id: checks.id });
      checkId = inserted[0]?.id ?? null;

      if (checkId !== null && result.flights.length > 0) {
        await db.insert(flightSnapshots).values(
          result.flights.slice(0, 60).map((f) => ({
            checkId,
            airlineCode: f.airlineCode,
            airlineName: f.airlineName,
            flightNo: f.flightNo,
            depTime: f.depTime,
            arrTime: f.arrTime,
            seatCount: f.seatCount,
            seatClass: f.seatClass,
            minFare: f.minFare,
          })),
        );
      }
    } catch (e) {
      console.error("check persist failed:", e);
    }
  }

  /* ── 핵심: 좌석이 보이면 화면을 보고 있지 않아도 서버가 스스로 알림을 보낸다 ── */
  let autoAlert: AutoAlertResult | null = null;
  if (result.ok && targets.length > 0) {
    try {
      autoAlert = await maybeAutoAlert(dep, arr, date, targets);
      console.log(
        `[자동 알림] ${dep}→${arr} ${date} ${autoAlert.sent ? "발송" : `건너뜀(${autoAlert.skipped})`} — ${autoAlert.detail}`,
      );
    } catch (e) {
      autoAlert = {
        sent: false,
        skipped: "error",
        detail: e instanceof Error ? e.message : String(e),
      };
    }
  }

  return NextResponse.json({
    ok: result.ok,
    checkId,
    dep,
    arr,
    date,
    maxHour,
    durationMs,
    totalFlights: result.flights.length,
    targetCount: targets.length,
    minFare,
    flights: result.flights,
    targets,
    autoAlert,
    diagnose: result.diagnose,
    error: result.error ?? null,
    telegram: await getTelegramConfig(),
  });
}
