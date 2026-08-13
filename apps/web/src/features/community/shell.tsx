"use client";

// 커뮤니티 세 화면이 함께 쓰는 껍데기와 조각들.
// 화면마다 다시 만들면 여백과 색이 조금씩 어긋나서 한곳에 모아 뒀다.

import Link from "next/link";

import { RailLayout } from "@/features/nav/app-rail";

export function CommunityShell({
  title,
  subtitle,
  back,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  back?: { href: string; label: string };
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <RailLayout>
      <main className="h-full">
        <div className="mx-auto w-full max-w-[760px] px-5 py-10">
          {back && (
            <Link
              href={back.href}
              className="text-[13px] font-bold text-[#8b95a1] hover:text-[#4e5968]"
            >
              ← {back.label}
            </Link>
          )}
          <div className="mt-3 flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-[26px] font-black tracking-[-0.03em] text-[#191f28]">
                {title}
              </h1>
              {subtitle && (
                <p className="mt-2 text-sm font-semibold leading-6 text-[#4e5968]">
                  {subtitle}
                </p>
              )}
            </div>
            {action ? <div className="flex shrink-0 whitespace-nowrap">{action}</div> : null}
          </div>
          {children}
        </div>
      </main>
    </RailLayout>
  );
}

export function Notice({ tone, children }: { tone: "error" | "muted"; children: React.ReactNode }) {
  const color = tone === "error" ? "text-[#e5484d]" : "text-[#8b95a1]";
  return <p className={`mt-8 text-sm font-semibold ${color}`}>{children}</p>;
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="rounded-2xl bg-[#3182f6] px-5 py-3 text-sm font-black text-white transition disabled:bg-[#c6d3e3]"
    >
      {children}
    </button>
  );
}

export function QuietButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl px-3 py-2 text-[13px] font-bold text-[#8b95a1] transition hover:text-[#4e5968] disabled:text-[#c6d3e3]"
    >
      {children}
    </button>
  );
}

/**
 * "3분 전"처럼 읽기 쉬운 시각.
 *
 * `now`는 화면이 목록을 받은 순간에 한 번 읽어 내려준다. 줄마다 Date.now()를 부르면
 * 정적 프리렌더 시각과 브라우저 시각이 어긋나 하이드레이션이 깨진다. `now`가 없으면
 * (아직 못 읽었으면) 빈 문자열이라 자리만 비어 보인다.
 */
export function relativeTime(iso: string, now: number | null): string {
  if (now === null) return "";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "방금";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}일 전`;
  return new Date(at).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

/** 익명 토글. 글쓰기와 댓글 두 곳에서 같은 모양으로 쓴다. */
export function AnonymousToggle({
  checked,
  onChange,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[13px] font-bold text-[#4e5968]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[#3182f6]"
      />
      익명으로
      {hint && <span className="font-semibold text-[#8b95a1]">{hint}</span>}
    </label>
  );
}
