import type {
  AnalysisReport,
  ExpressionReport,
  PracticeReport,
} from "@/lib/api/v2/types";
import { renderablePracticeReport } from "./coach-contract";

export function PracticeReportCards({ report }: { report: PracticeReport }) {
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

  return visibleReport.report_type === "analysis" ? (
    <AnalysisCards report={visibleReport} />
  ) : (
    <ExpressionCards report={visibleReport} />
  );
}

function AnalysisCards({ report }: { report: AnalysisReport }) {
  return (
    <div className="grid gap-4">
      <ReportHeading title={report.title} />
      <TextCard title="배우가 발견한 것" body={report.actor_discovery} />
      <TextCard title="이 말이 향하는 뜻" body={report.line_meaning} />
      <TextCard title="그 순간에 나온 이유" body={report.timing_reason} />
      <TextCard title="상대에게 만들려는 변화" body={report.target_effect} />
      <TextCard
        title="다음 장면에서 해볼 것"
        body={report.next_take.direction}
        untested={!report.next_take.tested}
      />
      <TextCard title="연기할 때 조심할 점" body={report.acting_caution} />
      <ListCard title="장면에서 확인한 근거" items={report.evidence} />
      <ListCard title="아직 열어 둔 부분" items={report.uncertainties} />
    </div>
  );
}

function ExpressionCards({ report }: { report: ExpressionReport }) {
  return (
    <div className="grid gap-4">
      <ReportHeading title={report.title} />
      <TextCard title="막힌 순간" body={report.blocked_point} />
      <TextCard title="표현의 중심" body={report.expression_core} />
      <TextCard title="이 말이 향하는 뜻" body={report.line_meaning} />
      <TextCard title="그 순간에 나온 이유" body={report.timing_reason} />
      <TextCard title="바로 해볼 행동" body={report.playable_action} />
      <TextCard title="직접 확인한 시도" body={report.effective_experiment.instruction} />
      <TextCard title="해보며 달라진 점" body={report.observed_change} />
      <TextCard title="다음 장면에서 해볼 것" body={report.next_take} />
      <TextCard title="연기할 때 조심할 점" body={report.acting_trap} />
      <TrainingCard report={report} />
      <ListCard title="장면에서 확인한 근거" items={report.evidence} />
      <ListCard title="배우가 직접 남긴 말" items={report.actor_words} />
      <ListCard title="아직 열어 둔 부분" items={report.uncertainties} />
    </div>
  );
}

function ReportHeading({ title }: { title: string }) {
  return (
    <header className="rounded-[28px] bg-[#2f6bff] p-6 text-white shadow-[0_16px_48px_rgba(25,31,40,0.08)]">
      <p className="text-sm font-black">오늘 정리</p>
      <h2 className="mt-2 text-2xl font-black leading-tight tracking-[-0.04em]">{title}</h2>
    </header>
  );
}

function TextCard({
  title,
  body,
  untested = false,
}: {
  title: string;
  body: string;
  untested?: boolean;
}) {
  if (!body.trim()) return null;
  return (
    <article className="rounded-[28px] bg-white p-5 shadow-[0_16px_48px_rgba(25,31,40,0.08)]">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-black text-[#191f28]">{title}</h3>
        {untested ? (
          <span className="rounded-2xl bg-[#f7faff] px-3 py-2 text-xs font-black text-[#2f6bff]">
            아직 해보지 않은 제안
          </span>
        ) : null}
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-7 text-[#4e5968]">
        {body}
      </p>
    </article>
  );
}

function ListCard({ title, items }: { title: string; items: string[] }) {
  const visibleItems = items.filter((item) => item.trim());
  if (visibleItems.length === 0) return null;
  return (
    <article className="rounded-[28px] bg-white p-5 shadow-[0_16px_48px_rgba(25,31,40,0.08)]">
      <h3 className="text-base font-black text-[#191f28]">{title}</h3>
      <ul className="mt-3 grid gap-2 text-sm font-semibold leading-7 text-[#4e5968]">
        {visibleItems.map((item, index) => <li key={`${index}-${item}`}>· {item}</li>)}
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
    <article className="rounded-[28px] bg-white p-5 shadow-[0_16px_48px_rgba(25,31,40,0.08)]">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-black text-[#191f28]">연습 방법 · {training.title}</h3>
        {!training.tested ? (
          <span className="rounded-2xl bg-[#f7faff] px-3 py-2 text-xs font-black text-[#2f6bff]">
            아직 해보지 않은 제안
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm font-black text-[#333d4b]">{training.duration_minutes}분</p>
      {lines.length > 0 ? (
        <ul className="mt-3 grid gap-2 text-sm font-semibold leading-7 text-[#4e5968]">
          {lines.map((line, index) => <li key={`${index}-${line}`}>· {line}</li>)}
        </ul>
      ) : null}
    </article>
  );
}
