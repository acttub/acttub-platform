"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";

const VARIANT: Record<Variant, string> = {
  primary: "bg-blue text-white font-bold active:bg-blue-dark disabled:bg-[#c9d3df] disabled:active:bg-[#c9d3df]",
  secondary: "bg-gray-bg text-ink font-bold active:bg-line disabled:opacity-40",
  ghost: "bg-transparent text-ink-4 font-semibold active:text-ink disabled:opacity-40",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  const sz = size === "lg" ? "h-13 text-[15px] px-6 rounded-[14px]" : size === "sm" ? "h-9 text-[13px] px-3 rounded-[10px]" : "h-12 text-[15px] px-5 rounded-[14px]";
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 transition-colors select-none ${sz} ${VARIANT[variant]} ${className}`}
      {...rest}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`bg-surface rounded-[18px] border border-line p-4 md:p-5 ${className}`}>{children}</section>;
}

export function CardTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-[16px] font-black text-ink">{title}</h2>
      {sub && <p className="text-[12.5px] text-ink-sub mt-0.5 leading-relaxed">{sub}</p>}
    </div>
  );
}

export type StepState = "done" | "on" | "off";

export function StepsPill({ states }: { states: [StepState, StepState, StepState] }) {
  const labels = ["대본 넣기", "배역 정하기", "바로 리딩"];
  return (
    <div className="grid grid-cols-3 gap-0.5 p-1 rounded-full bg-surface border border-line-soft">
      {labels.map((l, i) => {
        const s = states[i];
        return (
          <div
            key={l}
            className={`h-[34px] rounded-full flex items-center justify-center gap-1.5 text-[12px] ${
              s === "on" ? "bg-blue-soft text-blue font-extrabold" : s === "done" ? "text-ink-3 font-bold" : "text-ink-4 font-bold"
            }`}
          >
            {s === "done" ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-green">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : (
              <span className={`w-1.5 h-1.5 rounded-full ${s === "on" ? "bg-blue" : "bg-ink-5"}`} />
            )}
            {l}
          </div>
        );
      })}
    </div>
  );
}

export function TopBar({ title, onBack, right, hint }: { title: string; onBack?: () => void; right?: ReactNode; hint?: string }) {
  return (
    <header className="h-14 flex items-center justify-between gap-3 px-3.5 md:px-5 bg-surface border-b border-line-soft">
      <div className="flex items-center gap-2.5 min-w-0">
        {onBack && (
          <button type="button" onClick={onBack} aria-label="뒤로" className="w-8 h-8 rounded-[9px] bg-gray-bg flex items-center justify-center active:bg-line">
            <Icon name="chevron-left" size={18} />
          </button>
        )}
        <span className="text-[15px] font-black text-ink truncate">{title}</span>
        {hint && <span className="hidden md:inline text-[12.5px] text-ink-4 ml-2">{hint}</span>}
      </div>
      {right}
    </header>
  );
}

export function OptionRow({
  icon,
  title,
  sub,
  onClick,
  active,
}: {
  icon: IconName;
  title: string;
  sub: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-left transition-colors ${
        active ? "bg-blue-soft" : "bg-gray-bg active:bg-line"
      }`}
    >
      <Icon name={icon} size={20} className={active ? "text-blue" : "text-ink-3"} />
      <span className="flex-1 min-w-0">
        <span className={`block text-[14px] font-extrabold ${active ? "text-blue" : "text-ink"}`}>{title}</span>
        <span className="block text-[12px] text-ink-4">{sub}</span>
      </span>
      <Icon name="chevron-right" size={16} className="text-ink-5" />
    </button>
  );
}

export function SelectCard({
  selected,
  onClick,
  title,
  sub,
  icon,
  className = "",
  compact = false,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  sub?: string;
  icon?: IconName;
  className?: string;
  /** 한 줄 배치 — 배역처럼 항목이 많아 격자에 놓을 때. 이름은 꺾이지 않고 넘치면 말줄임. */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`min-w-0 flex items-center gap-2 text-left rounded-[14px] px-3.5 py-3 border transition-colors ${
          selected ? "bg-blue-soft border-blue border-[1.5px]" : "bg-surface border-line active:bg-gray-bg-2"
        } ${className}`}
      >
        <span className={`script-text min-w-0 flex-1 truncate text-[15px] font-black [word-break:keep-all] ${selected ? "text-blue" : "text-ink"}`}>{title}</span>
        {sub && <span className={`shrink-0 text-[12px] ${selected ? "text-blue-dark" : "text-ink-4"}`}>{sub}</span>}
        {selected && <Icon name="circle-check" size={18} className="shrink-0 text-blue" />}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 text-left rounded-[14px] px-3.5 py-3 border transition-colors ${
        selected ? "bg-blue-soft border-blue border-[1.5px]" : "bg-surface border-line active:bg-gray-bg-2"
      } ${className}`}
    >
      {icon && <Icon name={icon} size={20} className={`mb-1.5 ${selected ? "text-blue" : "text-ink-3"}`} />}
      <span className="flex items-center justify-between">
        <span className={`text-[15px] font-black ${selected ? "text-blue" : "text-ink"}`}>{title}</span>
        {selected && <Icon name="circle-check" size={18} className="text-blue" />}
      </span>
      {sub && <span className={`block text-[12px] mt-0.5 ${selected ? "text-blue-dark" : "text-ink-4"}`}>{sub}</span>}
    </button>
  );
}

export function StatusPill({ label, tone = "blue", dot = true }: { label: string; tone?: "blue" | "warn"; dot?: boolean }) {
  const cls = tone === "blue" ? "bg-blue-soft text-blue" : "bg-warn-bg text-warn";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-extrabold ${cls}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${tone === "blue" ? "bg-blue" : "bg-warn"}`} />}
      {label}
    </span>
  );
}

export function RoleName({ role, me, className = "" }: { role: string; me: boolean; className?: string }) {
  return <span className={`font-extrabold ${me ? "text-blue" : "text-partner"} ${className}`}>{role}</span>;
}

/* 작은 인라인 아이콘 세트 (lucide 경로) */
export type IconName =
  | "chevron-left"
  | "chevron-right"
  | "upload"
  | "clipboard"
  | "pencil"
  | "sparkles"
  | "check"
  | "circle-check"
  | "x"
  | "mic"
  | "volume"
  | "eye-off"
  | "timer"
  | "book";

const PATHS: Record<IconName, string> = {
  "chevron-left": "m15 18-6-6 6-6",
  "chevron-right": "m9 18 6-6-6-6",
  upload: "M12 3v12M5 10l7-7 7 7M5 21h14",
  clipboard: "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2",
  pencil: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
  sparkles: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9ZM5 19l.7 1.8L7.5 21.5l-1.8.7L5 24l-.7-1.8-1.8-.7 1.8-.7Z",
  check: "M20 6 9 17l-5-5",
  "circle-check": "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Zm-13 0 2 2 4-4",
  x: "M18 6 6 18M6 6l12 12",
  mic: "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM19 10v2a7 7 0 0 1-14 0v-2M12 19v3",
  volume: "M11 5 6 9H2v6h4l5 4V5ZM15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14",
  "eye-off": "M9.9 4.2A10 10 0 0 1 12 4c7 0 10 8 10 8a17 17 0 0 1-3 4M6.6 6.6A16 16 0 0 0 2 12s3 8 10 8a10 10 0 0 0 5.4-1.6M2 2l20 20M9.9 9.9a3 3 0 0 0 4.2 4.2",
  timer: "M10 2h4M12 14l3-3M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z",
  book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15ZM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5M8 7h8M8 11h6",
};

export function Icon({ name, size = 20, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}
