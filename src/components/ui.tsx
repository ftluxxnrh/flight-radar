"use client";

import type { ReactNode } from "react";

/* ────────────────────────── 아이콘 ────────────────────────── */

type IconProps = { className?: string };

export function RadarIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" opacity="0.5" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <path d="M12 12 L18.5 5.8" strokeLinecap="round" />
    </svg>
  );
}

export function PlaneIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M21.5 4.5c.9.9.6 2.4-.7 3.7l-3.4 3.4 2.1 8.1c.1.4-.1.7-.4.9l-.9.5c-.3.2-.7.1-.9-.2l-4-6.1-3.3 3.3.2 2.3c0 .3-.1.5-.3.7l-.5.5c-.3.3-.7.3-1 0l-2.1-2.1-2.1-2.1c-.3-.3-.3-.7 0-1l.5-.5c.2-.2.5-.3.7-.3l2.3.2 3.3-3.3-6.1-4c-.3-.2-.4-.6-.2-.9l.5-.9c.2-.3.5-.5.9-.4l8.1 2.1 3.4-3.4c1.3-1.3 2.8-1.6 3.7-.7Z" />
    </svg>
  );
}

export function BellIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
      <path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9Z" />
      <path d="M10 19.5a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}

export function SendIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
      <path d="M21.5 2.5 10.8 13.2M21.5 2.5l-7 19-3.7-8.3L2.5 9.5l19-7Z" strokeLinejoin="round" />
    </svg>
  );
}

export function AlertTriangleIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
    </svg>
  );
}

export function CheckIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ClockIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" strokeLinecap="round" />
    </svg>
  );
}

export function StopIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

/* ────────────────────────── 공용 부품 ────────────────────────── */

export function GlassCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`glass rounded-3xl ${className}`}>{children}</section>;
}

export function CardHead({
  icon,
  title,
  sub,
  right,
}: {
  icon?: ReactNode;
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/55 px-6 py-4">
      <div className="flex min-w-0 items-center gap-3">
        {icon ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[rgba(79,140,255,0.12)] text-acc">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-bold tracking-[-0.01em] text-ink">{title}</h2>
          {sub ? <p className="truncate text-[12.5px] text-mut">{sub}</p> : null}
        </div>
      </div>
      {right}
    </header>
  );
}

export function Pill({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "bad" | "acc" | "mut";
  children: ReactNode;
}) {
  const map = {
    ok: "bg-[rgba(34,197,94,0.13)] text-[#15803d] border-[rgba(34,197,94,0.3)]",
    warn: "bg-[rgba(245,158,11,0.14)] text-[#b45309] border-[rgba(245,158,11,0.32)]",
    bad: "bg-[rgba(239,68,68,0.11)] text-[#dc2626] border-[rgba(239,68,68,0.3)]",
    acc: "bg-[rgba(79,140,255,0.12)] text-[#2563eb] border-[rgba(79,140,255,0.3)]",
    mut: "bg-white/55 text-mut border-white/70",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-semibold ${map[tone]}`}
    >
      {children}
    </span>
  );
}

export function StatChip({
  label,
  value,
  sub,
  tone = "ink",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "ink" | "acc" | "ok" | "bad";
}) {
  const color = {
    ink: "text-ink",
    acc: "text-acc",
    ok: "text-[#16a34a]",
    bad: "text-[#dc2626]",
  }[tone];
  return (
    <div className="glass-soft rounded-2xl px-5 py-4">
      <p className="text-[12px] font-semibold text-mut">{label}</p>
      <p className={`tnum mt-1 text-[28px] font-extrabold tracking-tight ${color}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-[12px] text-mut">{sub}</p> : null}
    </div>
  );
}
