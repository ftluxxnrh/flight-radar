/**
 * preview 서버 재시작/프록시 절체 순간에는 API가 JSON 대신
 * HTML 오류 페이지(502/503 등)를 돌려줄 수 있다.
 * 응답을 항상 텍스트로 먼저 받아 파싱 가능 여부를 판별하는 안전 래퍼.
 */

export interface SafeJsonResult {
  /** 네트워크 요청 자체가 성공했는지 */
  networkOk: boolean;
  status: number;
  /** 응답 본문을 JSON으로 파싱했는지 */
  isJson: boolean;
  data: unknown;
  /** HTML 등 비-JSON 응답의 앞부분 (진단용) */
  rawHead: string;
  error?: string;
}

export async function fetchJsonSafe(
  url: string,
  init?: RequestInit,
): Promise<SafeJsonResult> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    return {
      networkOk: false,
      status: 0,
      isJson: false,
      data: null,
      rawHead: "",
      error: e instanceof Error ? e.message : String(e),
    };
  }

  let text = "";
  try {
    text = await res.text();
  } catch {
    /* 본문 읽기 실패는 빈 본문으로 취급 */
  }

  try {
    return {
      networkOk: true,
      status: res.status,
      isJson: true,
      data: JSON.parse(text),
      rawHead: "",
    };
  } catch {
    return {
      networkOk: true,
      status: res.status,
      isJson: false,
      data: null,
      rawHead: text.replace(/\s+/g, " ").slice(0, 90),
    };
  }
}

/** 비-JSON 응답일 때 로그에 남길 사람이 읽는 설명을 만든다. */
export function describeBadResponse(r: SafeJsonResult): string {
  if (!r.networkOk) {
    return `네트워크 오류: ${r.error ?? "연결 실패"}`;
  }
  if (!r.isJson) {
    if (r.status >= 500) {
      return `서버가 HTML 오류 페이지를 반환했습니다 (HTTP ${r.status}) — preview 서버 재시작 중일 수 있습니다.`;
    }
    if (r.status === 404) {
      return `API 라우트를 찾지 못했습니다 (HTTP 404) — 서버 재기동 중일 수 있습니다.`;
    }
    return `JSON이 아닌 응답이 도착했습니다 (HTTP ${r.status}).`;
  }
  return `응답은 받았지만 상태 코드가 비정상입니다 (HTTP ${r.status}).`;
}
