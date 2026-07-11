"use client";

import type { ImmutablePipelineReportDto, PipelineReportSectionDto } from "@/lib/api/types";

export const REPORT_FALLBACK = "아직 확인된 내용이 없어요.";

const REPORT_SECTIONS = [
  ["oneLineSummary", "한 줄 정리"],
  ["primaryReviewPoint", "가장 먼저 돌아볼 지점"],
  ["confirmedEvidence", "확인된 근거"],
  ["actorDiscovery", "배우가 발견한 점"],
  ["groundedEncouragement", "근거 있는 격려"],
  ["nextPracticeStep", "다음 연습"],
] as const satisfies ReadonlyArray<readonly [keyof ImmutablePipelineReportDto, string]>;

function formatRange(section: PipelineReportSectionDto) {
  if (!section.timestampRange) return null;
  const seconds = (value: number) => `${(value / 1000).toFixed(1)}초`;
  return `${seconds(section.timestampRange.startMs)}–${seconds(section.timestampRange.endMs)}`;
}

export function ReportView({ report, onSeek }: { report: ImmutablePipelineReportDto; onSeek: (startMs: number) => void }) {
  return (
    <section
      aria-labelledby="report-title"
      data-testid="pipeline-report"
      data-report-session-id={report.sessionId}
      data-report-source-run-id={report.sourceRunId}
    >
      <div className="mb-5">
        <p className="text-sm font-medium text-blue-600">저장된 연습 리포트</p>
        <h2 id="report-title" className="text-2xl font-bold">이번 연습에서 확인한 여섯 가지</h2>
        <p className="mt-1 text-sm text-slate-500">완료된 리포트는 바뀌지 않아요.</p>
      </div>
      <ol className="grid gap-4">
        {REPORT_SECTIONS.map(([key, title], index) => {
          const section = report[key] as PipelineReportSectionDto;
          const range = formatRange(section);
          const evidenceCount = section.observationEvidenceIds.length + section.turnEvidenceIds.length;
          return (
            <li
              key={key}
              data-testid="pipeline-report-section"
              data-report-section={key}
              data-report-status={section.status}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <p className="text-xs font-semibold text-slate-400">{index + 1} / 6</p>
              <h3 className="mt-1 font-semibold">{title}</h3>
              <p className="mt-3 whitespace-pre-wrap leading-7 text-slate-700">{section.status === "not_confirmed" || section.content === null ? REPORT_FALLBACK : section.content}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>연결된 근거 {evidenceCount}개</span>
                {range && section.timestampRange ? (
                  <button
                    type="button"
                    data-testid="pipeline-report-seek"
                    data-seek-start-ms={section.timestampRange.startMs}
                    onClick={() => onSeek(section.timestampRange!.startMs)}
                    className="rounded-full bg-blue-50 px-3 py-1.5 font-medium text-blue-700"
                  >
                    영상 {range} 보기
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
