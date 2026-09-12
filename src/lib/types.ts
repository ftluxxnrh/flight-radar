export interface FlightRow {
  itineraryId: string;
  airlineCode: string;
  airlineName: string;
  flightNo: string;
  depTime: string;
  arrTime: string;
  durationMin: number;
  seatCount: number;
  seatClass: string;
  minFare: number;
  supportNPay: boolean;
}

export interface TelegramInfo {
  configured: boolean;
  tokenPresent: boolean;
  chatIds: string[];
  missing: string[];
}

/** 웹 ↔ GitHub Actions 공유 감시 조건 */
export interface MonitorConfig {
  dep: string;
  arr: string;
  targetDate: string; // YYYYMMDD
  maxHour: number;
  intervalSec: number;
  enabled: boolean;
}

export interface ConfigResponse {
  ok: boolean;
  config: MonitorConfig;
  source: "db" | "default";
  updatedAt: string | null;
}

export interface AutoAlertInfo {
  sent: boolean;
  skipped: string | null;
  detail: string;
}

export interface CheckResponse {
  ok: boolean;
  checkId: number | null;
  dep: string;
  arr: string;
  date: string;
  maxHour: number;
  durationMs: number;
  totalFlights: number;
  targetCount: number;
  minFare: number | null;
  flights: FlightRow[];
  targets: FlightRow[];
  autoAlert: AutoAlertInfo | null;
  diagnose: {
    httpStatus: number;
    contentType: string;
    bytes: number;
    messageCount: number;
    isComplete: boolean;
  };
  error: string | null;
  telegram: TelegramInfo;
}

export interface CheckRecord {
  id: number;
  createdAt: string;
  dep: string;
  arr: string;
  depDate: string;
  status: string;
  totalFlights: number;
  targetCount: number;
  minFare: number | null;
  durationMs: number | null;
  error: string | null;
}

export interface AlertRecord {
  id: number;
  createdAt: string;
  kind: string;
  dep: string | null;
  arr: string | null;
  depDate: string | null;
  message: string;
  sentOk: boolean;
  detail: string | null;
}

export interface HistoryResponse {
  ok: boolean;
  checks: CheckRecord[];
  alerts: AlertRecord[];
  telegram: TelegramInfo;
}

export function fmtKst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

export function fmtKrw(n: number | null | undefined): string {
  if (n == null) return "-";
  return `${n.toLocaleString("ko-KR")}원`;
}
