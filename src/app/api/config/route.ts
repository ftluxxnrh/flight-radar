import { NextResponse } from "next/server";
import { db } from "@/db";
import { monitorConfig } from "@/db/schema";
import { AIRPORTS } from "@/lib/naver";
import type { MonitorConfig } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{8}$/;

export const DEFAULT_CONFIG: MonitorConfig = {
  dep: "CJJ",
  arr: "CJU",
  targetDate: "20260916",
  maxHour: 13,
  intervalSec: 30,
  enabled: true,
};

/** GET — 대시보드 초기값 로딩 + GitHub Actions monitor.js가 매 사이클 호출 */
export async function GET() {
  if (!db) {
    return NextResponse.json({
      ok: true,
      config: DEFAULT_CONFIG,
      source: "default",
      updatedAt: null,
    });
  }
  try {
    const rows = await db
      .select()
      .from(monitorConfig)
      .where(undefined)
      .limit(1);
    const row = rows[0];
    if (!row) {
      return NextResponse.json({
        ok: true,
        config: DEFAULT_CONFIG,
        source: "default",
        updatedAt: null,
      });
    }
    return NextResponse.json({
      ok: true,
      config: {
        dep: row.dep,
        arr: row.arr,
        targetDate: row.targetDate,
        maxHour: row.maxHour,
        intervalSec: row.intervalSec,
        enabled: row.enabled,
      } satisfies MonitorConfig,
      source: "db",
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (e) {
    return NextResponse.json({
      ok: true,
      config: DEFAULT_CONFIG,
      source: "default",
      updatedAt: null,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** PUT — 대시보드에서 조건 저장 (monitor.js는 다음 사이클부터 이 값을 사용) */
export async function PUT(req: Request) {
  let body: Partial<MonitorConfig>;
  try {
    body = (await req.json()) as Partial<MonitorConfig>;
  } catch {
    return NextResponse.json({ error: "잘못된 JSON 바디" }, { status: 400 });
  }

  const dep = (body.dep ?? "").toUpperCase();
  const arr = (body.arr ?? "CJU").toUpperCase();
  const targetDate = body.targetDate ?? "";
  const maxHour = Number(body.maxHour ?? 13);
  const intervalSec = Number(body.intervalSec ?? 30);
  const enabled = body.enabled !== false;

  if (!AIRPORTS[dep] || !AIRPORTS[arr]) {
    return NextResponse.json({ error: "공항 코드가 올바르지 않습니다." }, { status: 400 });
  }
  if (!DATE_RE.test(targetDate)) {
    return NextResponse.json(
      { error: "출발일은 YYYYMMDD 형식이어야 합니다." },
      { status: 400 },
    );
  }
  if (!Number.isFinite(maxHour) || maxHour < 1 || maxHour > 24) {
    return NextResponse.json({ error: "감시 시각대는 1~24 사이여야 합니다." }, { status: 400 });
  }
  if (!Number.isFinite(intervalSec) || intervalSec < 5 || intervalSec > 300) {
    return NextResponse.json({ error: "조회 주기는 5~300초 사이여야 합니다." }, { status: 400 });
  }
  if (!db) {
    return NextResponse.json(
      { error: "데이터베이스가 없어 조건을 저장할 수 없습니다." },
      { status: 503 },
    );
  }

  try {
    await db
      .insert(monitorConfig)
      .values({
        id: 1,
        dep,
        arr,
        targetDate,
        maxHour,
        intervalSec,
        enabled,
      })
      .onConflictDoUpdate({
        target: monitorConfig.id,
        set: {
          dep,
          arr,
          targetDate,
          maxHour,
          intervalSec,
          enabled,
          updatedAt: new Date(),
        },
      });
  } catch (e) {
    return NextResponse.json(
      { error: `저장 실패: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    config: { dep, arr, targetDate, maxHour, intervalSec, enabled },
    source: "db",
    updatedAt: new Date().toISOString(),
  });
}
