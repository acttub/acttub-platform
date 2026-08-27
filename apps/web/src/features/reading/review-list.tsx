"use client";

import { useEffect, useRef } from "react";
import type { ScriptLine } from "@/lib/reading/script/parse";
import { RoleName } from "@/features/reading/ui";

/** 대본 전체 목록 — 대본 확인(정적)과 리딩 왼쪽 열(현재 줄 하이라이트) 둘 다 쓴다 */
export function ReviewList({
  lines,
  myRole,
  currentIndex,
  className = "",
}: {
  lines: ScriptLine[];
  myRole: string;
  currentIndex?: number;
  className?: string;
}) {
  const curRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    curRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentIndex]);

  return (
    <div className={className}>
      {lines.map((l, i) => {
        const cur = currentIndex === i;
        const past = currentIndex !== undefined && i < currentIndex;
        return (
          <div
            key={i}
            ref={cur ? curRef : undefined}
            className={`flex gap-3 items-start px-2.5 py-2.5 rounded-[10px] ${cur ? "bg-blue-soft" : ""} ${
              currentIndex === undefined ? "border-b border-line-soft last:border-b-0" : ""
            }`}
          >
            <span className="w-11 shrink-0 text-[12.5px] leading-5">
              {l.type === "dialogue" && <RoleName role={l.role} me={l.role === myRole} className={past ? "opacity-40" : ""} />}
            </span>
            <span
              className={`script-text flex-1 text-[14px] leading-5 ${
                l.type === "direction" ? "italic text-ink-4" : cur ? "font-extrabold text-ink" : past ? "text-ink-5" : "text-ink"
              }`}
            >
              {l.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}
