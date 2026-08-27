"use client";

import type { StoredScript } from "@/lib/reading/storage";
import { Page } from "@/features/reading/page-shell";
import { ReviewList } from "@/features/reading/review-list";
import { Button, TopBar } from "@/features/reading/ui";

/** 폰 전용 — 데스크톱은 SetupScreen이 왼쪽 열에 같이 보여 준다 */
export function ReviewScreen({ script, onBack, onNext }: { script: StoredScript; onBack: () => void; onNext: () => void }) {
  const dialogue = script.lines.filter((l) => l.type === "dialogue");
  const directions = script.lines.length - dialogue.length;
  return (
    <Page>
      <TopBar
        title="대본 확인"
        onBack={onBack}
        right={
          <button type="button" onClick={onBack} className="text-[13px] font-bold text-blue">
            다시 넣기
          </button>
        }
      />
      <div className="flex-1 flex flex-col gap-3 p-4">
        <section className="bg-surface rounded-[18px] p-4 flex flex-col gap-2.5">
          <h1 className="script-text text-[17px] font-black">{script.title ?? "대본"}</h1>
          <p className="text-[12.5px] text-ink-sub">
            배역 {script.roles.length}명 · 대사 {dialogue.length}줄 · 지문 {directions}개
          </p>
          <div className="flex flex-wrap gap-2">
            {script.roles.map((r, i) => (
              <span key={r} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-bg text-[13px] font-extrabold">
                <span className={`w-2 h-2 rounded-full ${i === 0 ? "bg-blue" : "bg-partner-soft"}`} />
                {r}
                <span className="text-ink-4 font-semibold">{dialogue.filter((l) => l.role === r).length}줄</span>
              </span>
            ))}
          </div>
          <p className="text-[11.5px] text-ink-4">배역이 잘못 잡혔으면 대본을 다시 넣고 배역 이름을 알려 주세요.</p>
        </section>
        <section className="bg-surface rounded-[18px] px-4 py-1.5">
          <ReviewList lines={script.lines} myRole={script.roles[0]} />
        </section>
      </div>
      <div className="sticky bottom-0 p-4 bg-gray-bg-2/90 backdrop-blur">
        <Button size="lg" className="w-full" onClick={onNext}>
          배역 정하러 가기
        </Button>
      </div>
    </Page>
  );
}
