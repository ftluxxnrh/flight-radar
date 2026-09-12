"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CheckResponse,
  ConfigResponse,
  FlightRow,
  MonitorConfig,
  TelegramInfo,
} from "@/lib/types";
import { fmtKrw, fmtKst } from "@/lib/types";
import { describeBadResponse, fetchJsonSafe } from "@/lib/fetch";
import {
  AlertTriangleIcon,
  BellIcon,
  CardHead,
  CheckIcon,
  ClockIcon,
  GlassCard,
  Pill,
  PlaneIcon,
  RadarIcon,
  SendIcon,
  StatChip,
  StopIcon,
} from "@/components/ui";

const TARGET_DATE_ISO = "2026-09-16";
const TARGET = "2026-09-16T00:00:00+09:00";

const ROUTES = [
  { dep: "CJJ", label: "청주" },
  { dep: "GMP", label: "김포" },
  { dep: "PUS", label: "부산" },
  { dep: "TAE", label: "대구" },
  { dep: "KWJ", label: "광주" },
];

interface LogEntry {
  t: string;
  msg: string;
  tone: "info" | "ok" | "warn" | "bad";
}

function nowKst(): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

function kstToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function Page() {
  const [dep, setDep] = useState("CJJ");
  const [date, setDate] = useState(TARGET_DATE_ISO);
  const [maxHour, setMaxHour] = useState(13);
  const [intervalSec, setIntervalSec] = useState(30);
  const [running, setRunning] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CheckResponse | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [clock, setClock] = useState("--:--:--");
  const [dday, setDday] = useState("—");
  const [tgBusy, setTgBusy] = useState<"" | "test" | "alert">("");
  const [tgNote, setTgNote] = useState("");
  /* 날짜 하한은 마운트 후에만 계산해 서버/클라이언트 하이드레이션 불일치를 피한다 */
  const [minDate, setMinDate] = useState("");

  /* GitHub Actions 동기화 상태 */
  const [savedConfig, setSavedConfig] = useState<MonitorConfig | null>(null);
  const [savedAt, setSavedAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [watchEnabled, setWatchEnabled] = useState(true);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextAtRef = useRef<number | null>(null);

  const pushLog = useCallback((msg: string, tone: LogEntry["tone"] = "info") => {
    setLog((prev) => [{ t: nowKst(), msg, tone }, ...prev].slice(0, 24));
  }, []);

  /* 시계 & D-day */
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const tickClock = () => setClock(fmt.format(new Date()));
    const tickDday = () => {
      const diff =
        (new Date(TARGET).getTime() - new Date(`${kstToday()}T00:00:00+09:00`).getTime()) /
        86_400_000;
      setDday(diff > 0 ? `D-${Math.ceil(diff)}` : diff === 0 ? "D-DAY" : "지남");
    };
    tickClock();
    tickDday();
    const a = setInterval(tickClock, 1000);
    const b = setInterval(tickDday, 60_000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  const runCheck = useCallback(
    async (overrides?: { dep?: string; date?: string; maxHour?: number }) => {
    setChecking(true);
    const effDep = overrides?.dep ?? dep;
    const effDate = overrides?.date ?? date;
    const effMaxHour = overrides?.maxHour ?? maxHour;
    try {
      const qs = new URLSearchParams({
        dep: effDep,
        arr: "CJU",
        date: effDate.replace(/-/g, ""),
        maxHour: String(effMaxHour),
      });
      const parsed = await fetchJsonSafe(`/api/check?${qs.toString()}`);
      if (!parsed.networkOk || !parsed.isJson || !parsed.data) {
        pushLog(`${describeBadResponse(parsed)} 다음 사이클에 자동으로 재시도합니다.`, "bad");
        return;
      }
      const data = parsed.data as CheckResponse;
      setResult(data);

      if (!data.ok) {
        pushLog(`조회 실패 — ${data.error ?? "응답 오류"}`, "bad");
      } else if (data.targetCount > 0) {
        pushLog(
          `감시 시간대 좌석 ${data.targetCount}편 발견! (전체 예약 가능 ${data.totalFlights}편)`,
          "ok",
        );
        if (data.autoAlert?.sent) {
          pushLog("텔레그램 자동 알림을 발송했습니다.", "ok");
        } else if (data.autoAlert?.skipped === "unchanged") {
          /* 동일 좌석 유지 — 로그를 더럽히지 않음 */
        } else if (data.autoAlert?.skipped === "not-configured") {
          pushLog("텔레그램이 설정되지 않아 자동 알림을 보내지 못했습니다.", "warn");
        } else if (data.autoAlert) {
          pushLog(`자동 알림 발송 실패 — ${data.autoAlert.detail}`, "bad");
        }
      } else {
        pushLog(
          `오전편 잔여석 없음 — 전체 예약 가능 ${data.totalFlights}편 중 ${effMaxHour}시 이전 출발 0편`,
          data.totalFlights === 0 ? "warn" : "info",
        );
      }
    } catch (e) {
      pushLog(`오류: ${e instanceof Error ? e.message : String(e)}`, "bad");
    } finally {
      setChecking(false);
    }
  }, [dep, date, maxHour, pushLog]);

  /* 폴링 루프 */
  useEffect(() => {
    if (!running) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      await runCheck();
      if (cancelled) return;
      nextAtRef.current = Date.now() + intervalSec * 1000;
      timerRef.current = setTimeout(tick, intervalSec * 1000);
    };

    void tick();
    const counter = setInterval(() => {
      if (nextAtRef.current) {
        setCountdown(Math.max(0, Math.round((nextAtRef.current - Date.now()) / 1000)));
      }
    }, 250);

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      clearInterval(counter);
      nextAtRef.current = null;
      setCountdown(null);
    };
  }, [running, intervalSec, runCheck]);

  /* 조건 저장 → DB → 다음 GitHub Actions 사이클부터 자동 반영 */
  const saveConfig = useCallback(
    async (enabledOverride?: boolean) => {
      setSaving(true);
      const payload: MonitorConfig = {
        dep,
        arr: "CJU",
        targetDate: date.replace(/-/g, ""),
        maxHour,
        intervalSec,
        enabled: enabledOverride ?? watchEnabled,
      };
      try {
        const parsed = await fetchJsonSafe("/api/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (parsed.networkOk && parsed.isJson && parsed.data) {
          const data = parsed.data as ConfigResponse & { error?: string };
          if (data.ok && data.config) {
            setSavedConfig(data.config);
            setSavedAt(data.updatedAt ? fmtKst(data.updatedAt) : nowKst());
            if (enabledOverride !== undefined) setWatchEnabled(enabledOverride);
            pushLog(
              enabledOverride === false
                ? "감시 일시정지가 저장됐습니다 — Actions도 다음 사이클부터 멈춥니다."
                : enabledOverride === true
                  ? "감시 활성화가 저장됐습니다."
                  : "조건이 저장됐습니다 — 다음 GitHub Actions 실행(5분 내)부터 반영됩니다.",
              "ok",
            );
          } else {
            pushLog(`조건 저장 실패 — ${data.error ?? "응답 오류"}`, "bad");
          }
        } else {
          pushLog(`조건 저장 실패 — ${describeBadResponse(parsed)}`, "bad");
        }
      } catch (e) {
        pushLog(`조건 저장 오류: ${e instanceof Error ? e.message : String(e)}`, "bad");
      } finally {
        setSaving(false);
      }
    },
    [dep, date, maxHour, intervalSec, watchEnabled, pushLog],
  );

  /* 최초: 저장된 조건 불러오기 → 그 조건으로 즉시 1회 조회 */
  useEffect(() => {
    setMinDate(kstToday());
    (async () => {
      let overrides: { dep?: string; date?: string; maxHour?: number } = {};
      const parsed = await fetchJsonSafe("/api/config");
      if (parsed.networkOk && parsed.isJson && parsed.data) {
        const data = parsed.data as ConfigResponse;
        if (data.ok && data.source === "db" && data.config) {
          const c = data.config;
          const iso = `${c.targetDate.slice(0, 4)}-${c.targetDate.slice(4, 6)}-${c.targetDate.slice(6, 8)}`;
          setDep(c.dep);
          setDate(iso);
          setMaxHour(c.maxHour);
          setIntervalSec(c.intervalSec);
          setWatchEnabled(c.enabled);
          setSavedConfig(c);
          setSavedAt(data.updatedAt ? fmtKst(data.updatedAt) : "");
          overrides = { dep: c.dep, date: iso, maxHour: c.maxHour };
        }
      }
      await runCheck(overrides);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendTelegram = useCallback(
    async (kind: "test" | "alert") => {
      setTgBusy(kind);
      setTgNote("");
      try {
        const payload =
          kind === "alert" && result && result.targets.length > 0
            ? {
                kind: "seat_found",
                dep: result.dep,
                arr: result.arr,
                date: result.date,
                flights: result.targets.map((f) => ({
                  airlineName: f.airlineName,
                  flightNo: f.flightNo,
                  depTime: f.depTime,
                  minFare: f.minFare,
                })),
              }
            : { kind: "test" };
        const parsed = await fetchJsonSafe("/api/alert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!parsed.networkOk || !parsed.isJson || !parsed.data) {
          setTgNote(`${describeBadResponse(parsed)} 잠시 후 다시 시도해주세요.`);
          return;
        }
        const data = parsed.data as { ok: boolean; detail: string };
        setTgNote(data.ok ? `발송 성공 — ${data.detail}` : `발송 실패 — ${data.detail}`);
        pushLog(
          data.ok
            ? `텔레그램 ${kind === "alert" ? "좌석 경보" : "점검 메시지"} 발송 완료`
            : `텔레그램 발송 실패: ${data.detail}`,
          data.ok ? "ok" : "warn",
        );
      } catch (e) {
        setTgNote(`오류: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setTgBusy("");
      }
    },
    [result, pushLog],
  );

  const tg: TelegramInfo | undefined = result?.telegram;
  const hasTargets = (result?.targetCount ?? 0) > 0;

  return (
    <div className="min-h-screen pb-14">
      {/* ── 플로팅 글래스 내비게이션 ── */}
      <div className="sticky top-3 z-40 mx-auto w-full max-w-[1080px] px-4">
        <div className="glass flex items-center gap-3 rounded-2xl px-4 py-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-acc text-white shadow-[0_6px_18px_rgba(79,140,255,0.4)]">
            <PlaneIcon className="h-4 w-4" />
          </span>
          <p className="truncate text-[14px] font-bold tracking-tight text-ink">
            박종안 아버지를 위한 항공편 탐색기
          </p>
          <div className="ml-auto flex items-center gap-2">
            {tg ? (
              <Pill tone={tg.configured ? "ok" : "warn"}>
                {tg.configured ? `텔레그램 연동 · ${tg.chatIds.length}명` : "텔레그램 미설정"}
              </Pill>
            ) : null}
            <span className="tnum hidden rounded-full bg-white/55 px-3 py-1 text-[12.5px] font-semibold text-ink2 sm:inline-block">
              {clock}
            </span>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-[1080px] px-4">
        {/* ── 인사말 ── */}
        <section className="px-2 pt-10 pb-8 text-center">
          <div className="mb-4 flex items-center justify-center gap-2">
            <Pill tone="acc">{dday} · 9/16(수) 제주 강의</Pill>
            {running ? (
              <Pill tone="ok">
                <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-[#22c55e]" />
                감시 중
              </Pill>
            ) : (
              <Pill tone="mut">감시 대기</Pill>
            )}
          </div>
          <h1 className="text-[34px] font-extrabold leading-[1.2] tracking-[-0.025em] text-ink sm:text-[42px]">
            청주 → 제주 오전편 취소표,
            <br />
            나오는 즉시 알려드릴게요
          </h1>
          <p className="mx-auto mt-4 max-w-[560px] text-[15.5px] leading-[1.6] text-ink2">
            네이버 항공권을 {intervalSec}초마다 조회해 {maxHour}시 이전 출발편의 잔여석이 열리면
            아버님과 질문자님 스마트폰으로 텔레그램 알림을 보냅니다.
          </p>
        </section>

        {/* ── 감시 제어 ── */}
        <GlassCard className="mb-4">
          <div className="flex flex-wrap items-end gap-4 px-6 py-5">
            <label className="flex flex-col gap-1.5">
              <span className="field-label">출발 공항</span>
              <select className="field min-w-[130px]" value={dep} onChange={(e) => setDep(e.target.value)}>
                {ROUTES.map((r) => (
                  <option key={r.dep} value={r.dep}>
                    {r.label} ({r.dep})
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="field-label">출발일</span>
              <input
                type="date"
                className="field min-w-[150px]"
                value={date}
                min={minDate || undefined}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="field-label">감시 시간대</span>
              <select
                className="field min-w-[150px]"
                value={maxHour}
                onChange={(e) => setMaxHour(Number(e.target.value))}
              >
                {[9, 10, 11, 12, 13, 14].map((h) => (
                  <option key={h} value={h}>
                    {h}시 이전 출발편
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="field-label">조회 주기</span>
              <select
                className="field min-w-[100px]"
                value={intervalSec}
                onChange={(e) => setIntervalSec(Number(e.target.value))}
              >
                {[15, 30, 60].map((s) => (
                  <option key={s} value={s}>
                    {s}초
                  </option>
                ))}
              </select>
            </label>

            <div className="ml-auto flex items-center gap-2.5">
              <button
                type="button"
                className="btn btn-ghost h-[42px] px-5 text-[14px]"
                onClick={() => void runCheck()}
                disabled={checking}
              >
                <RadarIcon className="h-4 w-4" />
                {checking ? "조회 중…" : "지금 조회"}
              </button>
              <button
                type="button"
                className={`btn h-[42px] px-6 text-[14px] ${running ? "btn-danger-soft" : "btn-primary"}`}
                onClick={() => {
                  setRunning((v) => {
                    pushLog(v ? "감시를 정지했습니다." : `${intervalSec}초 간격 감시를 시작합니다.`, v ? "warn" : "ok");
                    return !v;
                  });
                }}
              >
                {running ? <StopIcon className="h-4 w-4" /> : <RadarIcon className="h-4 w-4" />}
                {running ? "감시 정지" : "감시 시작"}
              </button>
            </div>
          </div>

          {/* ── GitHub Actions 동기화 ── */}
          <div className="border-t border-white/55 px-6 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[13px] font-bold text-ink">
                  GitHub Actions 동기화
                  {savedConfig ? (
                    <span className="rounded-full bg-[rgba(79,140,255,0.12)] px-2 py-0.5 text-[10.5px] font-bold text-[#2563eb]">
                      저장됨 · {savedAt}
                    </span>
                  ) : (
                    <span className="rounded-full bg-white/55 px-2 py-0.5 text-[10.5px] font-bold text-mut">
                      기본값 사용 중
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-mut">
                  {savedConfig
                    ? `${savedConfig.dep}→제주 ${savedConfig.targetDate.slice(4, 6)}/${savedConfig.targetDate.slice(6, 8)} · <${savedConfig.maxHour}시 · ${savedConfig.intervalSec}초 주기 조건이 다음 Actions 실행(5분 내)부터 그대로 적용됩니다.`
                    : "아직 저장된 조건이 없어 Actions는 기본값(청주·9/16·13시)으로 동작합니다. 조건을 바꾸고 저장 버튼을 누르면 자동 반영돼요."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void saveConfig(!watchEnabled)}
                disabled={saving}
                className={`btn h-[38px] px-4 text-[13px] ${
                  watchEnabled ? "btn-ghost" : "btn-danger-soft"
                }`}
                title="GitHub Actions 감시를 켜고 끕니다 (웹에서 원격 정지)"
              >
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    watchEnabled ? "bg-[#22c55e]" : "bg-[#ef4444] blink"
                  }`}
                />
                {watchEnabled ? "감시 활성" : "일시정지됨"}
              </button>
              <button
                type="button"
                className="btn btn-primary h-[38px] px-5 text-[13px]"
                onClick={() => void saveConfig()}
                disabled={saving}
              >
                {saving ? "저장 중…" : "조건 저장"}
              </button>
            </div>
          </div>
          {running ? (
            <div className="flex items-center gap-2 border-t border-white/55 bg-[rgba(34,197,94,0.07)] px-6 py-2.5 text-[13px] font-semibold text-[#15803d]">
              <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-[#22c55e]" />
              감시 가동 중 — 다음 조회까지 {countdown ?? intervalSec}초
            </div>
          ) : null}
        </GlassCard>

        {/* ── 지표 ── */}
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatChip
            label="예약 가능 항공편"
            value={result ? String(result.totalFlights) : "—"}
            sub={date.replaceAll("-", ". ") + " 기준"}
          />
          <StatChip
            label={`감시 시간대 잔여편 (<${maxHour}시)`}
            value={result ? String(result.targetCount) : "—"}
            sub={hasTargets ? "취소표 발견!" : "오전편 없음"}
            tone={hasTargets ? "ok" : "ink"}
          />
          <StatChip
            label="최저 운임"
            value={result?.minFare ? fmtKrw(result.minFare) : "—"}
            sub="예약 가능 편 중"
            tone="acc"
          />
          <StatChip
            label="마지막 조회"
            value={result ? `${(result.durationMs / 1000).toFixed(1)}초` : "—"}
            sub={result?.ok ? "네이버 항공 응답 정상" : result ? "응답 오류" : "첫 조회 대기"}
            tone={result && !result.ok ? "bad" : "ink"}
          />
        </div>

        {/* ── 좌석 발견 배너 ── */}
        {hasTargets ? (
          <div className="glass mb-4 flex flex-wrap items-center gap-4 rounded-3xl border-[rgba(34,197,94,0.35)] px-6 py-4">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[rgba(34,197,94,0.15)] text-[#16a34a]">
              <CheckIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-bold text-ink">오전 시간대 좌석이 열렸습니다!</p>
              <p className="text-[13px] text-ink2">
                {result?.autoAlert?.sent
                  ? "텔레그램으로 자동 알림을 이미 보냈어요. 아래 보드의 목격 편을 바로 예약하세요."
                  : result?.autoAlert?.skipped === "unchanged"
                    ? "이미 알려드린 좌석과 동일해 재발송은 생략했어요. 목격 편을 바로 예약하세요."
                    : result?.autoAlert?.skipped === "not-configured"
                      ? "텔레그램이 설정되지 않아 자동 알림을 보내지 못했어요. 아래에서 수동 발송할 수 있습니다."
                      : "아래 보드의 목격 편을 바로 예약하세요. 텔레그램 경보도 보낼 수 있어요."}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary ml-auto h-[42px] px-5 text-[14px]"
              disabled={tgBusy !== ""}
              onClick={() => void sendTelegram("alert")}
            >
              <BellIcon className="h-4 w-4" />
              {tgBusy === "alert" ? "발송 중…" : "알림 다시 보내기"}
            </button>
          </div>
        ) : null}

        {result && !result.ok ? (
          <div className="glass mb-4 flex items-start gap-3 rounded-3xl px-6 py-4">
            <span className="mt-0.5 text-[#dc2626]">
              <AlertTriangleIcon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[14px] font-bold text-[#dc2626]">네이버 항공 조회 실패</p>
              <p className="mt-0.5 text-[13px] text-ink2">{result.error}</p>
            </div>
          </div>
        ) : null}

        {/* ── 출발 보드 ── */}
        <GlassCard className="mb-4 overflow-hidden">
          <CardHead
            icon={<PlaneIcon className="h-4.5 w-4.5" />}
            title={`${dep === "CJJ" ? "청주" : dep} → 제주 출발 보드`}
            sub="예약 가능한 항공편만 표시됩니다 · 매진편은 결과에 잡히지 않아요"
            right={
              result ? (
                <Pill tone={result.ok ? "ok" : "bad"}>
                  {result.ok ? "실시간 응답" : "응답 오류"}
                </Pill>
              ) : undefined
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-white/55 text-[12px] font-semibold text-mut">
                  <th className="px-6 py-3 font-semibold">출발 – 도착</th>
                  <th className="px-3 py-3 font-semibold">항공사</th>
                  <th className="px-3 py-3 font-semibold">편명</th>
                  <th className="px-3 py-3 text-right font-semibold">잔여석</th>
                  <th className="px-3 py-3 text-right font-semibold">최저 운임</th>
                  <th className="px-6 py-3 text-right font-semibold">판정</th>
                </tr>
              </thead>
              <tbody>
                {!result ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-[14px] text-mut">
                      첫 조회를 기다리는 중이에요…
                    </td>
                  </tr>
                ) : result.flights.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-[14px] text-mut">
                      {result.ok
                        ? "지금은 예약 가능한 항공편이 없어요 — 전편 매진 상태입니다."
                        : "조회에 실패해 표시할 데이터가 없어요."}
                    </td>
                  </tr>
                ) : (
                  result.flights.map((f: FlightRow) => {
                    const inWindow = Number(f.depTime.slice(0, 2)) < maxHour;
                    return (
                      <tr
                        key={f.itineraryId}
                        className={`border-b border-white/40 transition-colors last:border-0 ${
                          inWindow ? "bg-[rgba(79,140,255,0.09)]" : "hover:bg-white/35"
                        }`}
                      >
                        <td className={`tnum px-6 py-3 font-bold ${inWindow ? "text-[#2563eb]" : "text-ink"}`}>
                          {f.depTime}
                          <span className="mx-1.5 font-normal text-mut">→</span>
                          <span className={inWindow ? "text-[#2563eb]/75" : "text-mut"}>{f.arrTime}</span>
                        </td>
                        <td className="px-3 py-3 font-medium text-ink">{f.airlineName}</td>
                        <td className="tnum px-3 py-3 text-mut">{f.flightNo}</td>
                        <td className="tnum px-3 py-3 text-right font-semibold text-ink">
                          {f.seatCount >= 9 ? "9+" : f.seatCount}석
                        </td>
                        <td className="tnum px-3 py-3 text-right font-semibold text-ink">
                          {fmtKrw(f.minFare)}
                        </td>
                        <td className="px-6 py-3 text-right">
                          {inWindow ? <Pill tone="acc">목격</Pill> : <Pill tone="mut">시간대 밖</Pill>}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </GlassCard>

        {/* ── 텔레그램 + 이벤트 로그 ── */}
        <div className="grid gap-4 lg:grid-cols-2">
          <GlassCard>
            <CardHead
              icon={<BellIcon className="h-4.5 w-4.5" />}
              title="텔레그램 알림"
              sub="좌석이 발견되면 이곳에 등록된 번호로 즉시 발송됩니다"
              right={
                tg ? (
                  <Pill tone={tg.configured ? "ok" : "warn"}>
                    {tg.configured ? "연동 완료" : `미설정 (${tg.missing.join(", ")})`}
                  </Pill>
                ) : undefined
              }
            />
            <div className="space-y-3.5 px-6 py-5 text-[13.5px] leading-relaxed">
              <p className="rounded-2xl bg-[rgba(34,197,94,0.1)] px-4 py-3 text-[12.5px] text-[#166534]">
                <b>자동 알림이 켜져 있어요.</b> 감시 중 감시 시간대 좌석이 발견되면 이 화면을 보고
                있지 않아도 등록된 번호로 즉시 발송됩니다. 같은 좌석은 30분 동안 다시 알리지 않고,
                좌석 목록이 바뀌면 즉시 재발송합니다.
              </p>
              {tg?.configured ? (
                <p className="text-ink2">
                  봇 <b className="text-ink">@cjj_flight_bot</b>(아빠항공권알림)이 연동되어 있어요.
                  아래 버튼으로 실제 발송을 언제든 시험해볼 수 있습니다.
                </p>
              ) : (
                <p className="text-ink2">
                  서버에 <b>BOT_TOKEN</b>과 <b>CHAT_IDS</b> 환경변수가 없어 자동 알림이 꺼져 있어요.
                  로컬에서 돌리는 중이라면 프로젝트 루트에 <b>.env.local</b> 파일을 만들고
                  <code className="mx-1 rounded bg-white/60 px-1.5 py-0.5 text-[12px]">
                    BOT_TOKEN=… , CHAT_IDS=8917221122
                  </code>
                  두 줄을 넣은 뒤 서버를 재시작하세요.
                </p>
              )}
              <button
                type="button"
                className="btn btn-primary h-[42px] w-full text-[14px]"
                disabled={tgBusy !== ""}
                onClick={() => void sendTelegram("test")}
              >
                <SendIcon className="h-4 w-4" />
                {tgBusy === "test" ? "발송 중…" : "내 스마트폰으로 점검 메시지 보내기"}
              </button>
              {tgNote ? (
                <p className={`text-[12.5px] font-semibold ${tgNote.startsWith("발송 성공") ? "text-[#16a34a]" : "text-[#dc2626]"}`}>
                  {tgNote}
                </p>
              ) : null}
              <p className="rounded-2xl bg-white/45 px-4 py-3 text-[12.5px] text-mut">
                아버님 번호 추가: 아버님 휴대폰에서 @cjj_flight_bot 대화방의 <b>[시작]</b>을 누른 뒤,
                서버 설정의 <b>CHAT_IDS</b>에 발급되는 숫자를 쉼표로 이어서 적으면 다음 알림부터
                양쪽으로 함께 갑니다.
              </p>
            </div>
          </GlassCard>

          <GlassCard>
            <CardHead
              icon={<ClockIcon className="h-4.5 w-4.5" />}
              title="활동 기록"
              sub="조회·알림 활동이 최신순으로 남습니다"
            />
            <div className="max-h-[330px] overflow-y-auto px-4 py-3">
              {log.length === 0 ? (
                <p className="px-2 py-8 text-center text-[13px] text-mut">아직 기록이 없어요</p>
              ) : (
                log.map((l, i) => (
                  <div key={i} className="flex gap-2.5 border-b border-white/40 px-2 py-2 last:border-0">
                    <span className="tnum shrink-0 text-[12px] font-semibold text-mut/80">{l.t}</span>
                    <span
                      className={`text-[13px] leading-snug ${
                        l.tone === "ok"
                          ? "font-semibold text-[#16a34a]"
                          : l.tone === "bad"
                            ? "font-semibold text-[#dc2626]"
                            : l.tone === "warn"
                              ? "font-semibold text-[#b45309]"
                              : "text-ink2"
                      }`}
                    >
                      {l.msg}
                    </span>
                  </div>
                ))
              )}
            </div>
          </GlassCard>
        </div>

        {/* ── 푸터 ── */}
        <footer className="mt-10 text-center text-[12px] leading-relaxed text-mut">
          <p>
            박종안 아버지를 위한 항공편 탐색기 · 네이버 항공권 실시간 조회 · 9/16 강의 일정이 끝날
            때까지 함께합니다
          </p>
        </footer>
      </main>
    </div>
  );
}
