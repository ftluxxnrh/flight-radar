/** 텔레그램 Bot API 발송 헬퍼 (서버 전용 — 토큰은 절대 클라이언트로 내려가지 않는다) */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { bookingPageUrl, formatKrw } from "@/lib/naver";

export interface AlertFlight {
  airlineName: string;
  flightNo: string;
  depTime: string;
  minFare: number;
}

/** 좌석 발견 알림 메시지 구성 (/api/check 자동 알림과 /api/alert 수동 알림이 공용) */
export function buildSeatAlertMessage(
  dep: string,
  arr: string,
  depDate: string,
  flights: AlertFlight[],
): string {
  const dateLabel = depDate
    ? `${depDate.slice(4, 6)}/${depDate.slice(6, 8)}`
    : "출발일";
  let message = `🚨 <b>[취소표 좌석 발견!] ${dateLabel} ${dep}→제주</b>\n\n`;
  for (const f of flights) {
    message += `✈️ <b>${f.airlineName}</b> ${f.flightNo} · ${f.depTime} 출발 · ${formatKrw(f.minFare || 0)}~\n`;
  }
  message += `\n🔗 <a href="${bookingPageUrl(dep, arr, depDate)}">네이버 항공권 즉시 예약하기</a>`;
  return message;
}

/** 감지 좌석 목록의 지문 — 자동 알림 중복 방지 키 */
export function buildAlertKey(flights: AlertFlight[]): string {
  return flights
    .map((f) => `${f.flightNo}@${f.depTime}`)
    .sort()
    .join("|");
}

export interface TelegramConfig {
  configured: boolean;
  tokenPresent: boolean;
  chatIds: string[];
  missing: string[];
}

/* 환경변수가 없으면 DB의 app_settings에서 읽는다 (프리뷰 환경은 부팅마다
 * .env 파일이 초기화되므로 DB 저장이 유일한 영속 수단이다) */
let configCache: { at: number; cfg: TelegramConfig } | null = null;
const CONFIG_TTL_MS = 60_000;

export async function getTelegramConfig(): Promise<TelegramConfig> {
  if (configCache && Date.now() - configCache.at < CONFIG_TTL_MS) {
    return configCache.cfg;
  }

  let token = process.env.BOT_TOKEN ?? "";
  let chatIds = (process.env.CHAT_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if ((!token || chatIds.length === 0) && db) {
    try {
      const rows = await db.select().from(appSettings);
      const map: Record<string, string> = {};
      for (const r of rows) map[r.key] = r.value;
      if (!token && map.BOT_TOKEN) token = map.BOT_TOKEN;
      if (chatIds.length === 0 && map.CHAT_IDS) {
        chatIds = map.CHAT_IDS.split(",").map((s) => s.trim()).filter(Boolean);
      }
    } catch {
      /* DB 폴백 실패 시 미설정 상태로 진행 */
    }
  }

  const missing: string[] = [];
  if (!token) missing.push("BOT_TOKEN");
  if (chatIds.length === 0) missing.push("CHAT_IDS");
  const cfg: TelegramConfig = {
    configured: Boolean(token) && chatIds.length > 0,
    tokenPresent: Boolean(token),
    chatIds,
    missing,
  };
  configCache = { at: Date.now(), cfg };
  return cfg;
}

/** 발송 시 사용할 토큰 (환경변수 우선, 없으면 DB) */
export async function getTelegramToken(): Promise<string> {
  const envToken = process.env.BOT_TOKEN ?? "";
  if (envToken) return envToken;
  if (db) {
    try {
      const rows = await db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, "BOT_TOKEN"))
        .limit(1);
      if (rows[0]) return rows[0].value;
    } catch {
      /* 무시 */
    }
  }
  return "";
}

export interface TelegramSendResult {
  ok: boolean;
  sent: number;
  failed: number;
  detail: string;
}

export async function sendTelegramMessage(
  text: string,
): Promise<TelegramSendResult> {
  const cfg = await getTelegramConfig();
  if (!cfg.configured) {
    return {
      ok: false,
      sent: 0,
      failed: 0,
      detail: `텔레그램 미설정 — 서버 환경변수 ${cfg.missing.join(", ")} 필요`,
    };
  }

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  const token = await getTelegramToken();

  for (const chatId of cfg.chatIds) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: true,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (res.ok) sent += 1;
      else {
        failed += 1;
        const reason =
          res.status === 404
            ? "HTTP 404 — BOT_TOKEN 값이 잘못되었거나 폐기된 토큰입니다. .env.local 또는 시크릿의 값을 다시 확인하세요"
            : res.status === 401 || res.status === 403
              ? `HTTP ${res.status} — 토큰 권한 문제입니다`
              : res.status === 400
                ? `HTTP 400 — chat_id(${chatId})가 올바르지 않거나 봇 대화를 시작하지 않았습니다`
                : `HTTP ${res.status}`;
        errors.push(`${chatId}: ${reason}`);
      }
    } catch (e) {
      failed += 1;
      errors.push(`${chatId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    ok: sent > 0 && failed === 0,
    sent,
    failed,
    detail: errors.length > 0 ? errors.join(" / ") : `${sent}개 채팅 발송 완료`,
  };
}
