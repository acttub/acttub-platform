"use client";

/**
 * 완료(D19, reading.session)의 본문. 내 배역, 읽은 대사(구간 안 대사 줄 수), 걸린 시간, 다시 볼 대사(unmatched·
 * skipped 줄의 원문과 대사 번호, 없으면 절을 숨김), quiz 는 "맞춘 줄 K / 시도 N · 아직 안 나온 줄 P", 코치 카드
 * (촬영으로 잇는 안내, 리딩 자료는 보내지 않음), 다음 행동. 잘했는지를 말하는 문구는 없다.
 * 화면 껍데기(Page)는 DoneScreen 이 씌운다 — 문구 테스트가 이 본문만 그린다.
 */
import { quizSummaryLabel, reviewLines } from "@/lib/reading/session/results";
import type { RunStats, StoredScript } from "@/lib/reading/storage";
import { Button, Icon } from "@/features/reading/ui";

export const REVIEW_HEADING = (n: number) => `암기 필요 ${n}`;

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export const SAVING_COPY = "저장 중";

export function DoneBody({
  script,
  stats,
  repeating,
  error,
  saving = false,
  onRepeat,
  onChangeSetup,
  onNewScript,
  onDetail,
  onReview,
}: {
  script: StoredScript;
  stats: RunStats;
  repeating: boolean;
  error: string | null;
  /** 완료 저장이나 녹음 올리기가 아직 끝나지 않았다(재시도 중) */
  saving?: boolean;
  /** 같은 설정의 새 회차 */
  onRepeat: () => void;
  onChangeSetup: () => void;
  onNewScript: () => void;
  onDetail: () => void;
  /** 다시 볼 대사 전체보기 → 암기 화면(그 회차의 배역과 다시 볼 줄) */
  onReview?: () => void;
}) {
  const review = reviewLines(script, stats.lineResults);
  const items: [string, string][] = [
    [stats.myCharacterNames.join(", ") || "배역 미선택", "내 배역"],
    [`${stats.lineCount}줄`, "읽은 대사"],
    [fmt(stats.elapsedMs), "걸린 시간"],
  ];
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 md:gap-[18px] px-5 py-8 md:max-w-[560px] md:mx-auto w-full">
      <span className="w-16 h-16 md:w-[72px] md:h-[72px] rounded-full bg-blue-soft flex items-center justify-center">
        <Icon name="check" size={32} className="text-blue" />
      </span>
      <h1 className="text-[20px] md:text-[24px] font-black text-center">{stats.mode === "quiz" ? "암기 대조를 마쳤어요" : "리딩을 마쳤어요"}</h1>
      <p className="script-text text-[13px] font-bold text-ink-3 -mt-3">{script.title}</p>
      <p className="text-[13px] md:text-[14px] text-ink-sub text-center -mt-2">
        {stats.mode === "quiz" ? "말한 것을 글자로 바꿔 원문과 맞춰 본 결과예요." : "구간의 마지막 대사까지 이어갔어요."}
      </p>
      {saving && (
        <p className="text-[12px] font-bold text-ink-4 -mt-2" role="status">
          {SAVING_COPY} · 연결되면 자동으로 저장돼요
        </p>
      )}

      <div className="w-full grid grid-cols-3 bg-surface border border-line rounded-[18px] py-4 md:py-5">
        {items.map(([v, l]) => (
          <div key={l} className="flex flex-col items-center gap-1 px-2 text-center">
            <span className="text-[16px] md:text-[20px] font-black tabular-nums break-keep">{v}</span>
            <span className="text-[11.5px] md:text-[12px] font-bold text-ink-4">{l}</span>
          </div>
        ))}
      </div>

      {stats.mode === "quiz" && (
        <div className="w-full bg-warn-bg rounded-[18px] p-4">
          <p className="text-[13px] font-black text-warn">{quizSummaryLabel(stats.lineResults)}</p>
          <p className="text-[11.5px] text-warn/80 mt-0.5">여기까지가 글자예요. 말한 것을 글자로 바꿔 원문과 맞춰 본 것이에요.</p>
        </div>
      )}

      {review.length > 0 && (
        <section className="w-full bg-surface border border-line rounded-[18px] p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-black text-ink-3">{REVIEW_HEADING(review.length)}</h2>
            {onReview && (
              <button type="button" onClick={onReview} className="text-[12.5px] font-bold text-blue">
                전체보기
              </button>
            )}
          </div>
          <ul className="flex flex-col gap-1.5">
            {review.map((r) => (
              <li key={r.lineId} className="script-text text-[13.5px] leading-relaxed flex gap-2">
                <span className="shrink-0 text-[12px] font-bold text-ink-4 tabular-nums">{r.dialogueNo}번</span>
                <span className="text-ink">{r.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="w-full bg-navy rounded-[20px] p-5 md:p-6 flex flex-col gap-2">
        <p className="text-[12px] font-extrabold text-blue-light">코치</p>
        <p className="text-[16px] md:text-[17px] font-extrabold text-white leading-snug">상대 대사는 기기가 읽었어요. 네 대사에 무슨 생각을 담을지는 네가 정한 거예요.</p>
        <p className="text-[12.5px] md:text-[13px] text-muted leading-relaxed">이 장면을 촬영해 올리면 막힌 지점과 다음 시도를 질문으로 찾아요. 리딩 자료는 보내지 않아요.</p>
        <a href="/practice/new" className="text-[13.5px] font-extrabold text-blue-light mt-1">
          촬영 준비로 →
        </a>
      </div>

      {error && <p className="text-[12.5px] text-red">{error}</p>}
      <div className="w-full flex flex-col md:flex-row gap-2 mt-2">
        <Button variant="secondary" size="lg" className="w-full md:flex-1 order-2 md:order-1" onClick={onNewScript}>
          새 대본
        </Button>
        <Button size="lg" className="w-full md:flex-1 order-1 md:order-2" disabled={repeating} onClick={onRepeat}>
          {repeating ? "새 회차를 여는 중…" : stats.mode === "quiz" ? "다시 대조" : "다시 리딩"}
        </Button>
      </div>
      <div className="flex gap-4">
        <button type="button" onClick={onChangeSetup} className="text-[13px] font-bold text-ink-4">
          배역·방식 바꾸기
        </button>
        <button type="button" onClick={onDetail} className="text-[13px] font-bold text-ink-4">
          회차 목록 보기
        </button>
      </div>
    </div>
  );
}
