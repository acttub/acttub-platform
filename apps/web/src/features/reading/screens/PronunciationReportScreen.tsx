"use client";

/**
 * 리딩 발음 보고서 화면(SOMA-606, 실험·PRO). 앱 리딩 완료 화면의 「발음 보고서 받기」가 이 페이지를 앱 안에서 띄운다.
 * 앱 화면(apps/mobile/app/reading/pronunciation.tsx)과 같은 내용·순서다 — 대본대로 읽은 줄을 보이고, 이번 녹음에서 확실히
 * 다르게 들린 어절만 주황으로 칠한다. 들어 보기는 이번 녹음만 튼다(지난 녹음 비교·모범 음성 없음, 10/22 사용자).
 */
import type { ReactNode } from "react";
import {
  markSegments,
  markedLineCount,
  type PronunciationMark,
  type PronunciationReport,
} from "@/lib/reading/pronunciation-report";

export const PRON_COPY = {
  waiting: "녹음을 듣고 보고서를 만들고 있어요.\n1분쯤 걸려요.",
  skipped: "대본대로 읽은 줄이 없어서 보고서를 만들지 않았어요.",
  failed: "보고서를 만들지 못했어요. 나중에 다시 열어 주세요.",
  notReady: "발음 보고서는 준비 중이에요.\n준비되면 리딩이 끝난 화면에서 바로 받을 수 있어요.",
  titleSome: (count: number) => `${count}줄에서 다르게 들린 말이 있어요`,
  titleNone: "다르게 들린 말이 없었어요",
  sub: "주황색 말은 이번 녹음에서 대본과 다르게 들린 곳이에요. 눌러서 그 부분만 들어 보세요.",
  habitKind: "자주 보인 것",
  playWord: (word: string) => `'${word}' 듣기`,
  playLine: "줄 전체",
  misheardTitle: "다른 말로 알아들을 수 있는 곳",
  note: "자동으로 들은 결과라 틀릴 수 있어요.",
} as const;

export type ReportLineView = { lineNo: number; text: string; marks: PronunciationMark[]; canPlay: boolean };

/** 처음 불러오는 동안의 뼈대 — 빈 화면·빙글이 대신 보고서 모양을 미리 보인다. */
export function PronunciationSkeleton() {
  const bar = (w: string, h = "h-4", round = "rounded-md") => <div className={`${h} ${w} ${round} bg-gray-bg animate-pulse`} />;
  return (
    <div className="px-5 pt-5 flex flex-col gap-3" aria-busy="true" aria-label="발음 보고서를 불러오는 중">
      {bar("w-4/5", "h-6")}
      {bar("w-full", "h-3.5")}
      {bar("w-3/5", "h-3.5")}
      <div className="h-3" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2.5 mb-3">
          {bar(i === 1 ? "w-2/3" : "w-11/12", "h-5")}
          <div className="flex gap-2">
            {bar("w-24", "h-7", "rounded-full")}
            {bar("w-16", "h-7", "rounded-full")}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 가운데 한두 줄 안내(기다림·준비 중·실패). 빙글이 없이 짧은 문구만 둔다. */
export function PronunciationNotice({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 flex items-center justify-center px-8 py-24">
      <p className="text-[15px] leading-[22px] text-ink-sub text-center whitespace-pre-line">{children}</p>
    </div>
  );
}

function Chip({ label, tone, playing, onClick }: { label: string; tone: "mark" | "line"; playing: boolean; onClick: () => void }) {
  const color = tone === "mark" ? "text-[#E8590C]" : "text-blue-dark";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={playing}
      className={`inline-flex items-center gap-1.5 rounded-full bg-gray-bg px-3 py-[7px] text-[13px] font-semibold ${color}`}
    >
      <span aria-hidden className="inline-block w-3 text-center text-[10px] leading-none">
        {playing ? "■" : "▶"}
      </span>
      {label}
    </button>
  );
}

export function PronunciationReportBody({
  report,
  lines,
  playing,
  onPlay,
}: {
  report: PronunciationReport;
  lines: ReportLineView[];
  playing: string | null;
  onPlay: (key: string, lineNo: number, mark?: PronunciationMark) => void;
}) {
  const marked = markedLineCount(report);
  return (
    <div className="px-5 pt-5 pb-10 flex flex-col gap-[22px]">
      <div className="flex flex-col gap-2">
        <h1 className="text-[22px] leading-[30px] font-extrabold text-ink tracking-[-0.02em]">
          {marked > 0 ? PRON_COPY.titleSome(marked) : PRON_COPY.titleNone}
        </h1>
        <p className="text-[14px] leading-[21px] text-ink-sub">{PRON_COPY.sub}</p>
      </div>
      {report.habit && (
        <div className="flex flex-col gap-1">
          <p className="text-[13px] font-semibold text-ink-4">{PRON_COPY.habitKind}</p>
          <p className="text-[16px] font-semibold text-ink">{report.habit.label}</p>
        </div>
      )}
      {lines.map((line) => {
        const lineKey = `line-${line.lineNo}`;
        return (
          <div key={line.lineNo} className="flex flex-col gap-2.5">
            <p className="text-[18px] leading-[28px] text-ink">
              {markSegments(line.text, line.marks).map((seg, i) =>
                seg.marked ? (
                  <mark key={i} className="bg-[#FFF1E8] text-[#E8590C] font-bold rounded-[3px]">
                    {seg.text}
                  </mark>
                ) : (
                  <span key={i}>{seg.text}</span>
                ),
              )}
            </p>
            {line.canPlay && (
              <div className="flex flex-wrap gap-2">
                {line.marks.map((mark) => {
                  const key = `${lineKey}-${mark.index}`;
                  return (
                    <Chip key={key} tone="mark" label={PRON_COPY.playWord(mark.word)} playing={playing === key} onClick={() => onPlay(key, line.lineNo, mark)} />
                  );
                })}
                <Chip tone="line" label={PRON_COPY.playLine} playing={playing === lineKey} onClick={() => onPlay(lineKey, line.lineNo)} />
              </div>
            )}
          </div>
        );
      })}
      {report.misheard.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-semibold text-ink-4">{PRON_COPY.misheardTitle}</p>
          {report.misheard.map((m, i) => (
            <p key={i} className="text-[15px] leading-[22px] text-ink">
              {m.word} → {m.heard}
            </p>
          ))}
        </div>
      )}
      <p className="text-[12px] leading-[18px] text-ink-4">{PRON_COPY.note}</p>
    </div>
  );
}
