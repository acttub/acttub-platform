"use client";

import type { RunStats, Setup, StoredScript } from "@/lib/reading/storage";
import { Page } from "@/features/reading/page-shell";
import { Button, Icon } from "@/features/reading/ui";

export type { RunStats } from "@/lib/reading/storage";

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function DoneScreen({
  script,
  setup,
  stats,
  onRepeat,
  onChangeSetup,
  onNewScript,
}: {
  script: StoredScript;
  setup: Setup;
  stats: RunStats;
  onRepeat: () => void;
  onChangeSetup: () => void;
  onNewScript: () => void;
}) {
  const quiz = stats.mode === "quiz" ? stats.quiz : undefined;
  const items: [string, string][] = [
    [setup.myRole, "내 배역"],
    [`${stats.lineCount}줄`, stats.mode === "quiz" ? "내 대사" : "읽은 대사"],
    [fmt(stats.elapsedMs), "걸린 시간"],
  ];
  return (
    <Page>
      <div className="flex-1 flex flex-col items-center justify-center gap-4 md:gap-[18px] px-5 py-8 md:max-w-[560px] md:mx-auto w-full">
        <span className="w-16 h-16 md:w-[72px] md:h-[72px] rounded-full bg-blue-soft flex items-center justify-center">
          <Icon name="check" size={32} className="text-blue" />
        </span>
        <h1 className="text-[20px] md:text-[24px] font-black text-center">{stats.mode === "quiz" ? "암기 대조가 끝났습니다" : "리딩이 완료되었습니다"}</h1>
        {script.title && <p className="script-text text-[13px] font-bold text-ink-3 -mt-3">{script.title}</p>}
        <p className="text-[13px] md:text-[14px] text-ink-sub text-center -mt-2">
          {stats.mode === "quiz" ? "대사 정확도를 글자 기준으로 정리했어요." : "대본의 마지막 줄까지 이어갔어요."}
        </p>

        <div className="w-full grid grid-cols-3 bg-surface border border-line rounded-[18px] py-4 md:py-5">
          {items.map(([v, l]) => (
            <div key={l} className="flex flex-col items-center gap-1">
              <span className="text-[18px] md:text-[20px] font-black tabular-nums">{v}</span>
              <span className="text-[11.5px] md:text-[12px] font-bold text-ink-4">{l}</span>
            </div>
          ))}
        </div>

        {quiz && (
          <div className="w-full bg-warn-bg rounded-[18px] p-4 flex items-center justify-between">
            <div>
              <p className="text-[13px] font-black text-warn">대사 정확도 {quiz.attempted ? Math.round((quiz.passed / quiz.attempted) * 100) : 0}%</p>
              <p className="text-[11.5px] text-warn/80 mt-0.5">여기까지가 글자예요. 말한 것을 글자로 바꿔 대본과 맞춘 비율이에요.</p>
            </div>
            {quiz.pending > 0 && <span className="text-[12px] font-bold text-warn shrink-0">아직 안 나온 줄 {quiz.pending}</span>}
          </div>
        )}

        <div className="w-full bg-navy rounded-[20px] p-5 md:p-6 flex flex-col gap-2">
          <p className="text-[12px] font-extrabold text-blue-light">AI 코치</p>
          <p className="text-[16px] md:text-[17px] font-extrabold text-white leading-snug">
            상대 대사는 기계가 읽었어요. 네 대사에 무슨 생각을 담을지는 네가 정한 거예요.
          </p>
          <p className="text-[12.5px] md:text-[13px] text-muted leading-relaxed">이 장면을 촬영해 올리면 막힌 지점과 다음 시도를 질문으로 찾아요.</p>
          <a href="https://acttub.com" target="_blank" rel="noreferrer" className="text-[13.5px] font-extrabold text-blue-light mt-1">
            acttub에서 질문으로 →
          </a>
        </div>

        <div className="w-full flex flex-col md:flex-row gap-2 mt-2">
          <Button variant="secondary" size="lg" className="w-full md:flex-1 order-2 md:order-1" onClick={onNewScript}>
            새 대본
          </Button>
          <Button size="lg" className="w-full md:flex-1 order-1 md:order-2" onClick={onRepeat}>
            {stats.mode === "quiz" ? "다시 대조" : "다시 리딩"}
          </Button>
        </div>
        <button type="button" onClick={onChangeSetup} className="text-[13px] font-bold text-ink-4">
          배역·방식 바꾸기
        </button>
      </div>
    </Page>
  );
}
