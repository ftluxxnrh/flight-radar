#!/usr/bin/env node
/**
 * ============================================================
 *  flight-checker v2.1 — 취소표 감시 + 웹 대시보드 조건 동기화
 * ============================================================
 *  [신규] 웹 대시보드에서 저장한 감시 조건을 실행 시작 시 불러온다.
 *    - CONFIG_URL 에 대시보드의 /api/config 주소를 넣어두면
 *      출발 공항·날짜·시간대·폴링 주기·감시 활성/일시정지가
 *      웹에서 바꾼 그대로 다음 사이클부터 자동 반영된다.
 *    - 웹이 꺼져 있거나 값을 못 가져오면 아래 환경변수 기본값으로
 *      동작하므로 감시가 멈추는 일은 절대 없다.
 *
 *  [기존 유지]
 *    - 네이버 항공권 내부 검색 API 직접 폴링 (의존성 0)
 *    - 예약 가능 편만 응답되므로 "감시 시간대 결과 > 0 = 취소표"
 *    - 2회 연속 실패 시 대조군(김포→제주) 자가 진단 텔레그램 보고
 *    - 동일 좌석 목록 중복 알림 방지 (목록이 바뀌면 재알림)
 *
 *  필요한 Secrets / Variables (GitHub → Settings):
 *    BOT_TOKEN   텔레그램 봇 토큰
 *    CHAT_IDS    콤마 구분 수신자 chat id
 *    CONFIG_URL  (선택) https://본인주소.onrender.com/api/config
 */
'use strict';

const https = require('https');

/* ────────────────────────── 설정 ────────────────────────── */
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_IDS = (process.env.CHAT_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const CONFIG_URL = process.env.CONFIG_URL || '';

// 웹 설정을 못 받을 때 사용할 기본값 (환경변수로도 덮어쓸 수 있다)
const FALLBACK = {
  dep: process.env.DEPARTURE || 'CJJ',
  arr: process.env.ARRIVAL || 'CJU',
  date: process.env.TARGET_DATE || '20260916',
  maxHour: Number(process.env.MAX_HOUR || '13'),
  intervalSec: Number(process.env.INTERVAL_SEC || '30'),
  enabled: true,
};

const API_HOST = 'flight-api.naver.com';
const API_PATH = '/flight/domestic/searchFlights';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const DURATION_MS = Number(process.env.DURATION_SEC || '270') * 1000; // 4분 30초 감시

/* ───────────────────────── 유틸리티 ──────────────────────── */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const kst = () =>
  new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });

function tomorrowKst() {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + 86400000));
  return s.replace(/-/g, '');
}

/* ─────────────── 웹 대시보드 설정 불러오기 (신규) ─────────────── */
function fetchWebConfig() {
  return new Promise((resolve) => {
    if (!CONFIG_URL.startsWith('https://')) return resolve(null);
    let u;
    try {
      u = new URL(CONFIG_URL);
    } catch {
      return resolve(null);
    }
    const req = https.get(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        timeout: 10000,
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          try {
            const d = JSON.parse(text);
            resolve(d && d.ok && d.config ? d.config : null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
  });
}

async function loadConfig() {
  if (!CONFIG_URL) {
    console.log('[설정] CONFIG_URL 미지정 — 환경변수 기본값 사용');
    return { cfg: FALLBACK, fromWeb: false };
  }
  const web = await fetchWebConfig();
  if (!web) {
    console.log('[설정] 웹 대시보드 응답 없음 — 환경변수 기본값 사용');
    return { cfg: FALLBACK, fromWeb: false };
  }
  const cfg = {
    dep: String(web.dep || FALLBACK.dep).toUpperCase(),
    arr: String(web.arr || FALLBACK.arr).toUpperCase(),
    date: String(web.targetDate || FALLBACK.date),
    maxHour: Number(web.maxHour || FALLBACK.maxHour),
    intervalSec: Math.min(300, Math.max(5, Number(web.intervalSec || FALLBACK.intervalSec))),
    enabled: web.enabled !== false,
  };
  console.log(
    `[설정] 웹 대시보드 조건 로드: ${cfg.dep}→${cfg.arr} ${cfg.date} ` +
      `(<${cfg.maxHour}시, ${cfg.intervalSec}초 주기, ${cfg.enabled ? '활성' : '일시정지'})`
  );
  return { cfg, fromWeb: true };
}

/* ─────────────────── 텔레그램 발송 (의존성 0) ─────────────────── */
function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: 15000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('timeout', () => req.destroy(new Error('요청 시간 초과')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function sendTelegram(text) {
  if (!BOT_TOKEN || CHAT_IDS.length === 0) {
    console.warn('[텔레그램] BOT_TOKEN 또는 CHAT_IDS 미설정 — 알림 생략');
    return;
  }
  for (const chatId of CHAT_IDS) {
    try {
      const r = await postJson(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        { chat_id: chatId, text, parse_mode: 'HTML' }
      );
      if (r.status !== 200) console.error(`[전송 실패] ${chatId}: HTTP ${r.status}`);
    } catch (e) {
      console.error(`[전송 실패] ${chatId}: ${e.message}`);
    }
  }
}

/* ─────────────── 네이버 검색 API 호출 + SSE 파싱 ─────────────── */
function searchRequest(dep, arr, depDate) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      type: 'domestic',
      device: 'pc',
      fareType: 'Y',
      itineraries: [
        { departureAirport: dep, arrivalAirport: arr, departureDate: depDate },
      ],
      person: { adult: 1, child: 0, infant: 0 },
      tripType: 'OW',
      initialRequest: true,
      flightFilter: { filter: { type: 'departure' } },
    });

    const req = https.request(
      {
        hostname: API_HOST,
        path: API_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'Accept-Language': 'ko-KR,ko;q=0.9',
          Origin: 'https://flight.naver.com',
          Referer: 'https://flight.naver.com/',
          'User-Agent': UA,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 20000,
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode, text }));
      }
    );
    req.on('timeout', () => req.destroy(new Error('검색 API 시간 초과')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseFlights(sseText) {
  const merged = new Map();
  let airlineMap = {};
  let isComplete = false;

  for (const raw of sseText.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('data:')) continue;
    let msg;
    try {
      msg = JSON.parse(line.slice(5));
    } catch {
      continue;
    }
    if (!msg || typeof msg !== 'object') continue;
    if (msg.status) {
      airlineMap = Object.assign(airlineMap, msg.status.airlinesCodeMap || {});
      if (msg.status.isComplete === true) isComplete = true;
    }
    for (const f of msg.flights || []) {
      const seg = f && f.segment;
      if (!seg || !seg.departure || !seg.departure.time) continue;
      const t = String(seg.departure.time);
      const depTime = `${t.slice(0, 2)}:${t.slice(2, 4)}`;
      const at = String((seg.arrival || {}).time || '');
      merged.set(f.itineraryId || depTime, {
        airline: airlineMap[seg.airlineCode] || seg.airlineCode || '항공사',
        flightNo: `${seg.airlineCode || ''}${seg.flightNumber || ''}`,
        depTime,
        arrTime: at ? `${at.slice(0, 2)}:${at.slice(2, 4)}` : '',
        seats: Number(f.seatCount || 0),
        fare: Number(f.minFare || 0),
      });
    }
  }

  const flights = Array.from(merged.values()).sort((a, b) =>
    a.depTime.localeCompare(b.depTime)
  );
  return { flights, isComplete };
}

async function check(dep, arr, depDate) {
  const { status, text } = await searchRequest(dep, arr, depDate);
  if (status !== 201) {
    throw new Error(`네이버 API HTTP ${status} (${text.length}B)`);
  }
  return parseFlights(text);
}

/* ─────────────────────── 본문 루프 ─────────────────────── */
function buildAlert(cfg, pageUrl, targets) {
  const d = cfg.date;
  let msg = `🚨 <b>[취소표 좌석 발견!] ${d.slice(4, 6)}/${d.slice(6, 8)} ${cfg.dep}→제주</b>\n\n`;
  for (const f of targets) {
    msg += `✈️ <b>${f.airline}</b> ${f.flightNo} · ${f.depTime} 출발 · ${f.fare.toLocaleString('ko-KR')}원~\n`;
  }
  msg += `\n🔗 <a href="${pageUrl}">네이버 항공권 즉시 예약하기</a>`;
  return msg;
}

async function run() {
  const { cfg } = await loadConfig();

  // 웹 대시보드에서 일시정지해두면 실행하지 않고 조용히 종료
  if (!cfg.enabled) {
    console.log('웹 대시보드에서 감시가 일시정지되어 있습니다. 이번 사이클은 종료합니다.');
    return;
  }

  const pageUrl = `https://flight.naver.com/flights/domestic/${cfg.dep}-${cfg.arr}-${cfg.date}?adult=1&fareType=Y`;
  const intervalMs = cfg.intervalSec * 1000;

  console.log(`[감시] ${cfg.dep}→${cfg.arr} ${cfg.date} / <${cfg.maxHour}시 출발편 / ${cfg.intervalSec}초 간격 / ${DURATION_MS / 1000}초 창`);

  // 수동 트리거 시 점검 메시지 1회 발송 (현재 적용 중인 조건 포함)
  if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    await sendTelegram(
      `✅ <b>[시스템 점검]</b> 모니터 기동 — <b>${cfg.dep}→제주 ${cfg.date}</b> ` +
        `(&lt;${cfg.maxHour}시, ${cfg.intervalSec}초 주기) 조건으로 감시합니다.`
    );
  }

  const startedAt = Date.now();
  let fails = 0;
  let lastAlertKey = '';

  while (Date.now() - startedAt < DURATION_MS) {
    try {
      console.log(`[${kst()}] ${cfg.dep}→${cfg.arr} 예약 가능 좌석 조회 중...`);
      const { flights, isComplete } = await check(cfg.dep, cfg.arr, cfg.date);

      const targets = flights.filter(
        (f) => Number(f.depTime.slice(0, 2)) < cfg.maxHour
      );
      console.log(
        `👉 예약 가능 ${flights.length}편 (isComplete=${isComplete}) / 감시 시간대 ${targets.length}편`
      );

      if (targets.length > 0) {
        console.log('🚨 감시 시간대 좌석 발견!', targets);
        const key = targets
          .map((f) => `${f.flightNo}@${f.depTime}`)
          .sort()
          .join('|');
        if (key !== lastAlertKey) {
          await sendTelegram(buildAlert(cfg, pageUrl, targets));
          lastAlertKey = key;
        }
        await sleep(intervalMs);
      }
      fails = 0;
    } catch (err) {
      fails += 1;
      console.error(`조회 실패 (${fails}회 연속): ${err.message}`);

      if (fails === 2) {
        let diagnosis;
        try {
          const control = await check('GMP', 'CJU', tomorrowKst());
          diagnosis = control.flights.length > 0
            ? `대조군(김포→제주 내일)은 ${control.flights.length}편 정상 조회됨 → 대상 노선만 일시 오류일 가능성. 계속 재시도합니다.`
            : '대조군도 0편 → 네이버 측 일시 장애 가능성. 계속 재시도합니다.';
        } catch (controlErr) {
          diagnosis = `대조군 조회도 실패(${controlErr.message}) → 실행 환경 네트워크 차단 또는 네이버 API 장애 의심.`;
        }
        console.error('[진단] ' + diagnosis);
        await sendTelegram(
          `⚠️ <b>[감시 이상 보고]</b> ${cfg.dep}→제주 조회가 2회 연속 실패했습니다.\n${diagnosis}`
        );
      }
    }

    await sleep(intervalMs);
  }

  console.log('감시 윈도우 종료.');
}

run().catch((e) => {
  console.error('치명적 오류:', e);
  process.exit(1);
});
