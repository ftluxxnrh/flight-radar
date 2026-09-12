import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { alerts, checks } from "@/db/schema";
import { getTelegramConfig } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!db) {
    return NextResponse.json({
      ok: true,
      checks: [],
      alerts: [],
      telegram: await getTelegramConfig(),
    });
  }
  try {
    const [recentChecks, recentAlerts] = await Promise.all([
      db.select().from(checks).orderBy(desc(checks.createdAt)).limit(25),
      db.select().from(alerts).orderBy(desc(alerts.createdAt)).limit(8),
    ]);
    return NextResponse.json({
      ok: true,
      checks: recentChecks,
      alerts: recentAlerts,
      telegram: await getTelegramConfig(),
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        checks: [],
        alerts: [],
        telegram: await getTelegramConfig(),
      },
      { status: 500 },
    );
  }
}
