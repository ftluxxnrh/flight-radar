/**
 * 네이버 항공권 내부 검색 API (flight-api.naver.com) 직접 호출 클라이언트.
 *
 * 프론트엔드가 사용하는 실제 엔드포인트:
 *   POST https://flight-api.naver.com/flight/domestic/searchFlights
 *   응답: text/event-stream (SSE) — "data: {json}" 라인이 여러 개 스트리밍되며
 *   마지막 메시지에 status.isComplete === true 가 붙는다.
 *
 * 핵심 동작 특성:
 *   - 예약 가능한 좌석이 있는 항공편만 응답에 포함된다.
 *     (매진편은 결과 자체에서 누락 → "결과 수 > 0" 이 곧 취소표/잔여석 존재 신호)
 */

export const NAVER_API_URL =
  "https://flight-api.naver.com/flight/domestic/searchFlights";

export const AIRPORTS: Record<string, { name: string; city: string }> = {
  CJJ: { name: "청주국제공항", city: "청주" },
  GMP: { name: "김포국제공항", city: "김포(서울)" },
  CJU: { name: "제주국제공항", city: "제주" },
  PUS: { name: "김해국제공항", city: "부산" },
  TAE: { name: "대구국제공항", city: "대구" },
  KWJ: { name: "광주공항", city: "광주" },
  WJU: { name: "원주공항", city: "원주" },
  HIN: { name: "사천공항", city: "사천" },
  USH: { name: "울산공항", city: "울산" },
};

export function airportLabel(code: string): string {
  const a = AIRPORTS[code];
  return a ? `${a.city}(${code})` : code;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface NaverFlight {
  itineraryId: string;
  airlineCode: string;
  airlineName: string;
  flightNo: string;
  depTime: string; // "HH:MM"
  arrTime: string; // "HH:MM"
  durationMin: number;
  seatCount: number;
  seatClass: string;
  minFare: number;
  supportNPay: boolean;
}

export interface NaverDiagnose {
  httpStatus: number;
  contentType: string;
  bytes: number;
  messageCount: number;
  isComplete: boolean;
}

export interface NaverSearchResult {
  ok: boolean;
  flights: NaverFlight[];
  diagnose: NaverDiagnose;
  error?: string;
}

function buildBody(dep: string, arr: string, depDate: string) {
  return {
    type: "domestic",
    device: "pc",
    fareType: "Y",
    itineraries: [
      { departureAirport: dep, arrivalAirport: arr, departureDate: depDate },
    ],
    person: { adult: 1, child: 0, infant: 0 },
    tripType: "OW",
    initialRequest: true,
    flightFilter: { filter: { type: "departure" } },
  };
}

function hhmm(t: string): string {
  if (!t || t.length < 4) return "--:--";
  return `${t.slice(0, 2)}:${t.slice(2, 4)}`;
}

export function depHour(depTime: string): number {
  const h = Number(depTime.split(":")[0]);
  return Number.isFinite(h) ? h : 99;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseSseText(text: string): {
  flights: NaverFlight[];
  diagnose: NaverDiagnose;
} {
  const merged = new Map<string, NaverFlight>();
  let airlineMap: Record<string, string> = {};
  let messageCount = 0;
  let isComplete = false;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    let payload: any;
    try {
      payload = JSON.parse(line.slice(5).trim());
    } catch {
      continue;
    }
    if (!payload || typeof payload !== "object") continue;
    messageCount += 1;
    if (payload.status) {
      if (payload.status.airlinesCodeMap) {
        airlineMap = { ...airlineMap, ...payload.status.airlinesCodeMap };
      }
      if (payload.status.isComplete === true) isComplete = true;
    }
    if (!Array.isArray(payload.flights)) continue;
    for (const f of payload.flights) {
      try {
        const seg = f?.segment;
        if (!seg?.departure?.time) continue;
        const code: string = seg.airlineCode ?? "";
        const num: string = seg.flightNumber ?? "";
        merged.set(f.itineraryId ?? `${code}${num}-${seg.departure.time}`, {
          itineraryId: String(f.itineraryId ?? ""),
          airlineCode: code,
          airlineName: airlineMap[code] ?? code,
          flightNo: `${code}${num}`,
          depTime: hhmm(String(seg.departure.time)),
          arrTime: hhmm(String(seg.arrival?.time ?? "")),
          durationMin: Number(f.duration ?? 0),
          seatCount: Number(f.seatCount ?? 0),
          seatClass: String(f.seatClass ?? ""),
          minFare: Number(f.minFare ?? 0),
          supportNPay: Boolean(f.supportNPay),
        });
      } catch {
        // 개별 항공편 파싱 실패는 무시하고 계속 진행한다.
      }
    }
  }

  const flights = Array.from(merged.values()).sort((a, b) =>
    a.depTime.localeCompare(b.depTime),
  );

  return {
    flights,
    diagnose: {
      httpStatus: 0,
      contentType: "",
      bytes: text.length,
      messageCount,
      isComplete,
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function searchNaverFlights(
  dep: string,
  arr: string,
  depDate: string,
): Promise<NaverSearchResult> {
  const started = Date.now();
  try {
    const res = await fetch(NAVER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
        Origin: "https://flight.naver.com",
        Referer: "https://flight.naver.com/",
        "User-Agent": UA,
      },
      body: JSON.stringify(buildBody(dep, arr, depDate)),
      signal: AbortSignal.timeout(25_000),
    });

    const text = await res.text();
    const base = {
      httpStatus: res.status,
      contentType: res.headers.get("content-type") ?? "",
      bytes: text.length,
      messageCount: 0,
      isComplete: false,
    };

    if (!res.ok || !base.contentType.includes("event-stream")) {
      return {
        ok: false,
        flights: [],
        diagnose: base,
        error: `네이버 API가 정상 응답을 거부했습니다 (HTTP ${res.status}, ${base.contentType || "타입 없음"}, ${base.bytes}B). WAF 차단 또는 요청 스키마 변경 의심.`,
      };
    }

    const { flights, diagnose } = parseSseText(text);
    return {
      ok: true,
      flights,
      diagnose: { ...base, ...diagnose, httpStatus: res.status },
    };
  } catch (e) {
    const elapsed = Date.now() - started;
    return {
      ok: false,
      flights: [],
      diagnose: {
        httpStatus: 0,
        contentType: "",
        bytes: 0,
        messageCount: 0,
        isComplete: false,
      },
      error: `조회 중 예외 발생 (${elapsed}ms): ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export function bookingPageUrl(dep: string, arr: string, depDate: string) {
  return `https://flight.naver.com/flights/domestic/${dep}-${arr}-${depDate}?adult=1&fareType=Y`;
}

export function formatKrw(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}

/** 오늘 기준(한국 시간) YYYYMMDD +days */
export function kstDatePlus(days: number): string {
  const now = new Date(Date.now() + days * 86_400_000);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(now).replace(/-/g, "");
}
