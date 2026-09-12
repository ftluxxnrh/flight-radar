import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** 1회 조회 사이클 기록 (대시보드/모니터가 네이버 항공권을 조회할 때마다 기록) */
export const checks = pgTable("checks", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  dep: text("dep").notNull(),
  arr: text("arr").notNull(),
  depDate: text("dep_date").notNull(), // YYYYMMDD
  status: text("status").notNull(), // "ok" | "error"
  totalFlights: integer("total_flights").notNull().default(0),
  targetCount: integer("target_count").notNull().default(0), // 감시 시간대(오전) 잔여편 수
  minFare: integer("min_fare"),
  durationMs: integer("duration_ms"),
  error: text("error"),
});

/** 조회 시점에 예약 가능했던 항공편 스냅샷 */
export const flightSnapshots = pgTable("flight_snapshots", {
  id: serial("id").primaryKey(),
  checkId: integer("check_id").references(() => checks.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  airlineCode: text("airline_code").notNull(),
  airlineName: text("airline_name").notNull(),
  flightNo: text("flight_no").notNull(),
  depTime: text("dep_time").notNull(), // HH:MM
  arrTime: text("arr_time"),
  seatCount: integer("seat_count").notNull().default(0),
  seatClass: text("seat_class"),
  minFare: integer("min_fare"),
});

/**
 * 런타임 설정 저장소 — 환경변수가 없는 배포 환경에서도
 * 텔레그램 토큰 등을 유지하기 위한 폴백 (환경변수가 항상 우선한다)
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * 감시 조건 — 웹 대시보드에서 저장하면 GitHub Actions의
 * monitor.js가 매 사이클 시작 시 /api/config 로 읽어간다 (실시간 동기화)
 */
export const monitorConfig = pgTable("monitor_config", {
  id: integer("id").primaryKey(), // 항상 1번 행 하나만 사용
  dep: text("dep").notNull(),
  arr: text("arr").notNull(),
  targetDate: text("target_date").notNull(), // YYYYMMDD
  maxHour: integer("max_hour").notNull().default(13),
  intervalSec: integer("interval_sec").notNull().default(30),
  enabled: boolean("enabled").notNull().default(true), // 웹에서 끄면 Actions도 정지
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** 텔레그램 발송 이력 */
export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  kind: text("kind").notNull(), // "seat_found" | "test" | "error"
  dep: text("dep"),
  arr: text("arr"),
  depDate: text("dep_date"),
  message: text("message").notNull(),
  sentOk: boolean("sent_ok").notNull().default(false),
  detail: text("detail"),
  /** 자동 알림 중복 방지용 — 감지된 좌석 목록 지문 (편명@출발시각 조합) */
  alertKey: text("alert_key"),
});
