import type { PracticeNote } from "@/lib/practice/api-types";
import type {
  AnalysisReport,
  ExpressionReport,
  PracticeReport,
  PublicPracticeNote,
} from "@/lib/api/v2/types";
import { renderablePracticeReport } from "./coach-contract";
import {
  FALLBACK_NOTICE,
  isNoteV2,
  legacyReportOf,
  noteCheer,
  nextTakeCopy,
  noteQuotes,
  noteTitle,
  quoteSourceLabel,
} from "./practice-note";

export function PracticeReportCards({
  report,
  groupTitle = "",
}: {
  report: PracticeReport | PracticeNote;
  /** 초점 없이 끝난 노트가 쓸 대체 제목(묶음의 이름). */
  groupTitle?: string;
}) {
  // 신형 노트는 요약 인용·종류·폴백을 들고 온다. 옛 노트는 아래 옛 경로로 간다.
  if (isNoteV2(report)) {
    const legacy = legacyReportOf(report);
    if (legacy) return <PracticeReportCards report={legacy} groupTitle={groupTitle} />;
    return <PracticeNoteV2Cards note={report} groupTitle={groupTitle} />;
  }
  const visibleReport = renderablePracticeReport(report);
  if (!visibleReport) {
    return (
      <section className="px-6 py-10 text-center">
        <h2 className="text-xl font-black text-[#191f28]">오늘은 여기까지 나눴어요</h2>
        <p className="mt-3 text-sm font-semibold leading-6 text-[#4e5968]">
          노트로 남기기엔 짧아서, 다음에 이어서 해요.
        </p>
      </section>
    );
  }

  switch (visibleReport.report_type) {
    case "analysis": return <AnalysisCards report={visibleReport} />;
    case "expression": return <ExpressionCards report={visibleReport} />;
    case "practice_note": return <PracticeNoteCards report={visibleReport} />;
    default: return <p className="p-6 text-sm">새로고침하면 이 연습 노트를 다시 불러올 수 있어요.</p>;
  }
}

/**
 * 신형 노트. 순서는 짧은 요약 → 다음 촬영에서 해볼 한 가지 → 응원이고, 그 사이에 비교 기준이나
 * 확인을 강제하는 자리를 두지 않는다.
 */
function PracticeNoteV2Cards({ note, groupTitle }: { note: PracticeNote; groupTitle: string }) {
  const quotes = noteQuotes(note);
  const actorWords = note.actor_words;
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[68ch]">
      <ReportHeading title={noteTitle(note, groupTitle)} />
      {note.fallback ? (
        <p className="rounded-xl bg-[#fff8ec] px-3.5 py-2.5 text-xs font-bold leading-5 text-[#8a4b00]">
          {FALLBACK_NOTICE}
        </p>
      ) : null}
      <article className="min-w-0 border-t border-[#e5e8eb] py-6">
        <h3 className="text-xs font-black text-[#4e5968]">이번 대화 요약</h3>
        {quotes.length === 0 ? (
          <p className="mt-3 text-base font-semibold leading-7 text-[#191f28]">
            오늘 나눈 이야기를 그대로 남겼어요.
          </p>
        ) : (
          <ul className="mt-3 grid gap-3">
            {quotes.map((quote, index) => (
              <li key={`${index}-${quote.quote}`} className="border-l-2 border-[#e5e8eb] pl-4">
                <p className="break-words whitespace-pre-wrap text-base font-semibold leading-7 text-[#191f28]">
                  {quote.quote}
                </p>
                <p className="mt-1 text-[11.5px] font-black text-[#8b95a1]">{quoteSourceLabel(quote.kind)}</p>
              </li>
            ))}
          </ul>
        )}
      </article>
      <article className="min-w-0 border-t border-[#e5e8eb] py-6">
        <h3 className="text-xs font-black text-[#4e5968]">다음 촬영에서 해볼 것</h3>
        <p className="mt-3 break-words whitespace-pre-wrap text-lg font-bold leading-7 text-[#191f28]">
          {nextTakeCopy(note)}
        </p>
      </article>
      {actorWords.length > 0 ? (
        <ListCard title="배우가 직접 남긴 말" items={actorWords} quoted />
      ) : null}
      <p className="border-t border-[#e5e8eb] py-6 text-sm font-medium leading-6 text-[#4e5968]">
        {noteCheer(note) || "오늘 촬영도 수고했어요."}
      </p>
    </div>
  );
}

function PracticeNoteCards({ report }: { report: PublicPracticeNote }) {
  const summary = report.summary?.trim()
    || (report.focus ? `${report.focus.label} 부분을 함께 살펴봤어요.` : "이번에는 구체적인 촬영 방향을 정하지 않았어요.");
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[68ch]">
      <ReportHeading title={report.title} />
      <TextCard title="이번 대화 요약" body={summary} />
      <article className="min-w-0 border-t border-[#e5e8eb] py-6">
        <h3 className="text-xs font-black text-[#4e5968]">다음 촬영에서 해볼 것</h3>
        <p className="mt-3 break-words whitespace-pre-wrap text-lg font-bold leading-7 text-[#191f28]">
          {report.practice?.instruction || "이번에는 촬영 아이템을 정하지 않았어요."}
        </p>
      </article>
      <p className="border-t border-[#e5e8eb] py-6 text-sm font-medium leading-6 text-[#4e5968]">
        오늘 촬영도 수고했어요.<br />다음 촬영도 응원할게요.
      </p>
    </div>
  );
}

function AnalysisCards({ report }: { report: AnalysisReport }) {
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[68ch]">
      <ReportHeading title={report.title} />
      <TextCard title="배우가 발견한 것" body={report.actor_discovery} quoted />
      <TextCard title="이 말이 향하는 뜻" body={report.line_meaning} />
      <TextCard title="그 순간에 나온 이유" body={report.timing_reason} />
      <TextCard title="상대에게 만들려는 변화" body={report.target_effect} />
      <TextCard
        title="다음 장면에서 해볼 것"
        body={report.next_take.direction}
        untested={!report.next_take.tested}
      />
      <ListCard title="장면에서 확인한 근거" items={report.evidence} quoted />
      <ListCard title="아직 열어 둔 부분" items={report.uncertainties} />
    </div>
  );
}

function ExpressionCards({ report }: { report: ExpressionReport }) {
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[68ch]">
      <ReportHeading title={report.title} />
      <TextCard title="막힌 순간" body={report.blocked_point} />
      <TextCard title="표현의 중심" body={report.expression_core} />
      <TextCard title="이 말이 향하는 뜻" body={report.line_meaning} />
      <TextCard title="그 순간에 나온 이유" body={report.timing_reason} />
      <TextCard title="바로 해볼 행동" body={report.playable_action} />
      <TextCard title="직접 확인한 시도" body={report.effective_experiment.instruction} />
      <TextCard title="해보며 달라진 점" body={report.observed_change} />
      <TextCard title="다음 장면에서 해볼 것" body={report.next_take} />
      <TrainingCard report={report} />
      <ListCard title="장면에서 확인한 근거" items={report.evidence} quoted />
      <ListCard title="배우가 직접 남긴 말" items={report.actor_words} />
      <ListCard title="아직 열어 둔 부분" items={report.uncertainties} />
    </div>
  );
}

function ReportHeading({ title }: { title: string }) {
  return (
    <header className="min-w-0 pb-7 pt-2">
      <p className="text-xs font-black text-[#4e5968]">오늘 정리</p>
      <h2 className="mt-2 break-words text-2xl font-black leading-tight tracking-[-0.04em] text-[#191f28]">
        {title}
      </h2>
    </header>
  );
}

function TextCard({
  title,
  body,
  untested = false,
  quoted = false,
}: {
  title: string;
  body: string;
  untested?: boolean;
  quoted?: boolean;
}) {
  if (!body.trim()) return null;
  return (
    <article className="min-w-0 border-t border-[#e5e8eb] py-6">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-black text-[#4e5968]">{title}</h3>
        {untested ? (
          <span className="rounded-2xl bg-[#f7faff] px-3 py-2 text-xs font-black text-[#3182f6]">
            아직 해보지 않은 제안
          </span>
        ) : null}
      </div>
      <p
        className={`mt-3 break-words whitespace-pre-wrap text-base font-semibold leading-7 text-[#191f28] ${
          quoted ? "border-l-2 border-[#e5e8eb] pl-4" : ""
        }`}
      >
        {body}
      </p>
    </article>
  );
}

function ListCard({
  title,
  items,
  quoted = false,
}: {
  title: string;
  items: string[];
  quoted?: boolean;
}) {
  const visibleItems = items.filter((item) => item.trim());
  if (visibleItems.length === 0) return null;
  return (
    <article className="min-w-0 border-t border-[#e5e8eb] py-6">
      <h3 className="text-xs font-black text-[#4e5968]">{title}</h3>
      <ul
        className={`mt-3 grid gap-2 break-words text-base font-semibold leading-7 text-[#191f28] ${
          quoted ? "border-l-2 border-[#e5e8eb] pl-4" : ""
        }`}
      >
        {visibleItems.map((item, index) => (
          <li key={`${index}-${item}`}>
            {quoted ? null : "· "}
            {item}
          </li>
        ))}
      </ul>
    </article>
  );
}

function TrainingCard({ report }: { report: ExpressionReport }) {
  const training = report.actor_training;
  const lines = [
    training.purpose,
    ...training.steps,
    training.focus,
    training.success_check,
  ].filter((line) => line.trim());
  if (!training.title.trim() && lines.length === 0) return null;

  return (
    <article className="min-w-0 border-t border-[#e5e8eb] py-6">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-black text-[#4e5968]">연습 방법 · {training.title}</h3>
        {!training.tested ? (
          <span className="rounded-2xl bg-[#f7faff] px-3 py-2 text-xs font-black text-[#3182f6]">
            아직 해보지 않은 제안
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm font-black text-[#333d4b]">{training.duration_minutes}분</p>
      {lines.length > 0 ? (
        <ul className="mt-3 grid gap-2 break-words text-base font-semibold leading-7 text-[#191f28]">
          {lines.map((line, index) => (
            <li key={`${index}-${line}`}>· {line}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
