import { NextResponse } from "next/server";
import { db } from "@/db";
import { alerts } from "@/db/schema";
import {
  buildAlertKey,
  buildSeatAlertMessage,
  getTelegramConfig,
  sendTelegramMessage,
} from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AlertPayload {
  kind?: string;
  dep?: string;
  arr?: string;
  date?: string;
  flights?: { airlineName: string; flightNo: string; depTime: string; minFare: number }[];
}

export async function POST(req: Request) {
  let body: AlertPayload;
  try {
    body = (await req.json()) as AlertPayload;
  } catch {
    return NextResponse.json({ error: "잘못된 JSON 바디" }, { status: 400 });
  }

  const kind = body.kind === "seat_found" ? "seat_found" : "test";
  const dep = body.dep ?? "CJJ";
  const arr = body.arr ?? "CJU";
  const date = body.date ?? "";

  let message: string;
  let alertKey: string | null = null;
  if (kind === "seat_found" && Array.isArray(body.flights) && body.flights.length > 0) {
    message = buildSeatAlertMessage(dep, arr, date, body.flights);
    alertKey = buildAlertKey(body.flights);
  } else {
    message =
      "✅ <b>[시스템 점검]</b> 취소표 감시 대시보드 알림 테스트입니다. 이 메시지가 보였다면 텔레그램 연동이 정상입니다!";
  }

  const result = await sendTelegramMessage(message);

  try {
    if (db) {
      await db.insert(alerts).values({
        kind,
        dep,
        arr,
        depDate: date || null,
        message,
        sentOk: result.ok,
        detail: result.detail,
        alertKey,
      });
    }
  } catch (e) {
    console.error("alert persist failed:", e);
  }

  return NextResponse.json({
    ...result,
    configured: (await getTelegramConfig()).configured,
    message,
  });
}
