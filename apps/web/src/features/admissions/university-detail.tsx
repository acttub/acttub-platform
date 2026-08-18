"use client";

import Link from "next/link";

import {
  countdown,
  getUniversityAdmissions,
  groupTips,
  isOpen,
  weightBars,
  DISCIPLINE_LABEL,
  PRACTICAL_LABEL,
  SOURCE_LABEL,
  type AdmissionNotice,
  type AdmissionResource,
  type AdmissionTip,
  type AdmissionUniversity,
} from "@/lib/api/v2/admissions";
import { useResource } from "@/lib/react/use-resource";
import { RailLayout } from "@/features/nav/app-rail";

import { localDate } from "./local-date";

export function UniversityDetailPage({ universityId }: { universityId: string }) {
  const admissions = useResource(
    universityId,
    (id, signal) => getUniversityAdmissions(id, { signal }),
    "입시 정보를 불러오지 못했어요.",
  );

  const answered = admissions.state === "ready" ? admissions : null;
  const payload = answered?.data ?? null;
  // 답이 온 시각을 오늘로 읽는다 — 렌더 중에 읽으면 프리렌더된 HTML 과 어긋난다.
  const today = answered ? localDate(answered.receivedAt) : null;

  const university = payload?.universities[0] ?? null;

  return (
    <RailLayout>
      <main className="h-full">
        <div className="mx-auto w-full max-w-[760px] px-5 py-10">
          <Link
            href="/admissions"
            className="text-[13px] font-black text-[#8b95a1] hover:text-[#4e5968]"
          >
            ← 입시 정보
          </Link>

          {/*
            서버가 준 말(`admissions.message`)을 일부러 쓰지 않는다 — 옛 코드가 오류를
            세워 두고도 렌더에서 버리고 이 문구만 그렸다. 목록 화면(admissions-page)은
            서버 말을 그리므로 둘이 갈려 있고, 어느 쪽으로 맞출지는 이 커밋의 일이 아니다.
          */}
          {admissions.state === "failed" && (
            <p className="mt-8 text-sm font-semibold text-[#e5484d]">
              입시 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
            </p>
          )}

          {admissions.state === "loading" && (
            <p className="mt-8 text-sm font-semibold text-[#8b95a1]">
              불러오는 중이에요…
            </p>
          )}

          {payload && !university && (
            <p className="mt-8 text-sm font-semibold text-[#8b95a1]">
              해당 대학을 찾을 수 없어요.
            </p>
          )}

          {payload && university && (
            <>
              <Header university={university} />

              <p className="mt-4 rounded-2xl bg-[#fff4e6] px-4 py-3 text-[13px] font-bold leading-5 text-[#b45309]">
                ⓘ {payload.disclaimer}
              </p>

              {payload.notices.length === 0 ? (
                <p className="mt-8 rounded-2xl bg-[#f8fbff] px-5 py-6 text-[14px] font-semibold leading-6 text-[#4e5968]">
                  {university.note ??
                    "아직 전형 정보를 확인하지 못했어요. 입학처 원문에서 확인해 주세요."}
                </p>
              ) : (
                <div className="mt-6 space-y-4">
                  {payload.notices.map((notice) => (
                    <NoticeCard key={notice.id} notice={notice} today={today} />
                  ))}
                </div>
              )}

              {university.tips.length > 0 && <TipList tips={university.tips} />}

              {university.resources.length > 0 && (
                <ResourceList resources={university.resources} />
              )}

              <p className="mt-8 text-[12px] font-semibold leading-5 text-[#8b95a1]">
                {payload.updated_at} 기준 · 각 대학 모집요강 원문을 사람이 직접 읽고
                채우고 있어요
                <br />
                입시결과에 적힌 학생부 숫자는 최종등록자의 교과 성적이에요. 실기 성적은
                대부분의 대학이 공개하지 않지만, 공개한 곳은 함께 적어 뒀어요.
              </p>
            </>
          )}
        </div>
      </main>
    </RailLayout>
  );
}

function Header({ university }: { university: AdmissionUniversity }) {
  return (
    <header className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-[26px] font-black tracking-[-0.03em] text-[#191f28]">
          {university.name}
        </h1>
        {university.campus && (
          <span className="rounded-full bg-[#f2f4f6] px-2.5 py-1 text-[12px] font-black text-[#4e5968]">
            {university.campus}
          </span>
        )}
        {university.type === "college" && (
          <span className="rounded-full bg-[#f2f4f6] px-2.5 py-1 text-[12px] font-black text-[#4e5968]">
            전문대
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {university.region && (
          <span className="text-[13px] font-bold text-[#8b95a1]">
            {university.region}
          </span>
        )}
        <a
          href={university.admission_url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[13px] font-black text-[#3182f6] hover:underline"
        >
          입학처 원문 ↗
        </a>
      </div>
    </header>
  );
}

function NoticeCard({
  notice,
  today,
}: {
  notice: AdmissionNotice;
  today: string | null;
}) {
  const remaining = today ? countdown(notice, today) : null;
  const closed = Boolean(today) && !isOpen(notice, today as string);
  const bars = weightBars(notice.weights);

  return (
    <section className="rounded-2xl border border-[#e5e8eb] bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        {notice.track && (
          <span className="rounded-full bg-[#e8f3ff] px-2.5 py-1 text-[11px] font-black text-[#3182f6]">
            {notice.track}
          </span>
        )}
        {notice.discipline && (
          <span className="rounded-full bg-[#f2f4f6] px-2.5 py-1 text-[11px] font-black text-[#4e5968]">
            {DISCIPLINE_LABEL[notice.discipline] ?? notice.discipline}
          </span>
        )}
        {remaining ? (
          <span className="ml-auto rounded-full bg-[#191f28] px-2.5 py-1 text-[11px] font-black text-white">
            {remaining.label} D-{remaining.days === 0 ? "DAY" : remaining.days}
          </span>
        ) : (
          closed && (
            <span className="ml-auto rounded-full bg-[#e5e8eb] px-2.5 py-1 text-[11px] font-black text-[#8b95a1]">
              접수 마감
            </span>
          )
        )}
      </div>

      <h2 className="mt-2 text-[19px] font-black tracking-[-0.02em] text-[#191f28]">
        {notice.department ?? "학과 미확인"}
      </h2>
      {notice.screening && (
        <p className="mt-1 text-[13px] font-bold text-[#4e5968]">{notice.screening}</p>
      )}

      <Schedule notice={notice} />

      {bars.length > 0 && <WeightBar bars={bars} note={notice.weights_note} />}
      {bars.length === 0 && notice.weights_note && (
        <Block label="전형요소 반영비율" value={notice.weights_note} />
      )}

      {notice.stages.length > 0 && <Stages notice={notice} />}
      {notice.practical_items.length > 0 && <PracticalItems notice={notice} />}

      <div className="mt-4 space-y-3">
        <Block label="실기 과제 원문" value={notice.practical_task} />
        <Block label="복장" value={notice.dress_code} />
        <Block label="준비물" value={notice.preparation} />
        <Block label="제출서류" value={notice.documents} />
        <Block label="수능 최저" value={notice.csat_minimum} />

        {notice.designated_works.length > 0 && (
          <div>
            <p className="text-[12px] font-black text-[#191f28]">지정 작품</p>
            <ul className="mt-1 space-y-0.5">
              {notice.designated_works.map((work) => (
                <li
                  key={work}
                  className="text-[13px] font-semibold leading-5 text-[#4e5968]"
                >
                  · {work}
                </li>
              ))}
            </ul>
          </div>
        )}

        {notice.essay_questions.length > 0 && (
          <div>
            <p className="text-[12px] font-black text-[#191f28]">제출 문항</p>
            <ol className="mt-1 space-y-1">
              {notice.essay_questions.map((question, index) => (
                <li
                  key={question}
                  className="text-[13px] font-semibold leading-5 text-[#4e5968]"
                >
                  {index + 1}. {question}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {notice.results.length > 0 && <ResultTable notice={notice} />}

      {notice.note && (
        <p className="mt-4 text-[12px] font-semibold leading-5 text-[#8b95a1]">
          {notice.note}
        </p>
      )}

      {notice.source_url && (
        <a
          href={notice.source_url}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-4 block text-[12px] font-black text-[#3182f6] hover:underline"
        >
          원문 공고 보기 ↗
        </a>
      )}
    </section>
  );
}

/** 원서접수 → 실기 → 발표. 세로로 세워 순서가 눈에 들어오게 한다. */
function Schedule({ notice }: { notice: AdmissionNotice }) {
  const steps = [
    { label: "원서접수", value: period(notice.apply_start, notice.apply_end) },
    {
      label: "실기고사",
      value: period(notice.practical_date, notice.practical_date_end),
    },
    { label: "합격발표", value: notice.announce_date ?? null },
  ].filter((step) => step.value);

  if (steps.length === 0 && !notice.quota && !notice.fee) return null;

  return (
    <dl className="mt-4 grid gap-x-4 gap-y-2 rounded-xl bg-[#f8fbff] p-4 text-[13px] font-semibold text-[#4e5968] sm:grid-cols-2">
      {steps.map((step) => (
        <div key={step.label} className="flex gap-3">
          <dt className="w-[60px] shrink-0 text-[#8b95a1]">{step.label}</dt>
          <dd className="min-w-0 flex-1 text-[#191f28]">{step.value}</dd>
        </div>
      ))}
      {notice.quota && (
        <div className="flex gap-3">
          <dt className="w-[60px] shrink-0 text-[#8b95a1]">모집인원</dt>
          <dd className="min-w-0 flex-1 text-[#191f28]">{notice.quota}</dd>
        </div>
      )}
      {notice.fee && (
        <div className="flex gap-3">
          <dt className="w-[60px] shrink-0 text-[#8b95a1]">전형료</dt>
          <dd className="min-w-0 flex-1 text-[#191f28]">{notice.fee}</dd>
        </div>
      )}
    </dl>
  );
}

const BAR_COLOR: Record<string, string> = {
  practical: "bg-[#3182f6]",
  transcript: "bg-[#8b95a1]",
  csat: "bg-[#b0b8c1]",
  interview: "bg-[#00c7ae]",
  portfolio: "bg-[#f5a623]",
  other: "bg-[#e5e8eb]",
};

function WeightBar({
  bars,
  note,
}: {
  bars: { key: string; label: string; value: number }[];
  note?: string | null;
}) {
  const total = bars.reduce((sum, bar) => sum + bar.value, 0);

  return (
    <div className="mt-4">
      <p className="text-[12px] font-black text-[#191f28]">전형요소 반영비율</p>
      <div className="mt-2 flex h-3 overflow-hidden rounded-full">
        {bars.map((bar) => (
          <div
            key={bar.key}
            className={BAR_COLOR[bar.key] ?? "bg-[#e5e8eb]"}
            style={{ width: `${(bar.value / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {bars.map((bar) => (
          <span
            key={bar.key}
            className="flex items-center gap-1.5 text-[12px] font-bold text-[#4e5968]"
          >
            <i
              className={`inline-block h-2 w-2 rounded-full ${BAR_COLOR[bar.key] ?? "bg-[#e5e8eb]"}`}
            />
            {bar.label} {bar.value}%
          </span>
        ))}
      </div>
      {note && (
        <p className="mt-1.5 text-[12px] font-semibold leading-5 text-[#8b95a1]">
          {note}
        </p>
      )}
    </div>
  );
}

/** 몇 배수를 뽑는지가 지원 판단을 가른다. 단계를 접지 않고 그대로 편다. */
function Stages({ notice }: { notice: AdmissionNotice }) {
  const stages = [...notice.stages].sort((a, b) => a.order - b.order);

  return (
    <div className="mt-4">
      <p className="text-[12px] font-black text-[#191f28]">단계별 전형</p>
      <ol className="mt-2 space-y-2">
        {stages.map((stage) => (
          <li
            key={stage.order}
            className="rounded-xl border border-[#e5e8eb] px-4 py-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#191f28] px-2 py-0.5 text-[11px] font-black text-white">
                {stage.order}단계
              </span>
              <span className="text-[14px] font-black text-[#191f28]">
                {stage.name}
              </span>
              {stage.multiple && (
                <span className="rounded-full bg-[#e8f3ff] px-2 py-0.5 text-[11px] font-black text-[#3182f6]">
                  {stage.multiple}
                </span>
              )}
              {typeof stage.weight === "number" && (
                <span className="ml-auto text-[12px] font-bold text-[#4e5968]">
                  {stage.weight === 0 ? "성적 미반영" : `반영 ${stage.weight}%`}
                </span>
              )}
            </div>
            {(stage.date || stage.evaluates.length > 0) && (
              <p className="mt-1.5 text-[12px] font-semibold text-[#4e5968]">
                {stage.date}
                {stage.date && stage.evaluates.length > 0 && " · "}
                {stage.evaluates
                  .map((category) => PRACTICAL_LABEL[category] ?? category)
                  .join(", ")}
              </p>
            )}
            {stage.note && (
              <p className="mt-1 text-[12px] font-semibold leading-5 text-[#8b95a1]">
                {stage.note}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function PracticalItems({ notice }: { notice: AdmissionNotice }) {
  return (
    <div className="mt-4">
      <p className="text-[12px] font-black text-[#191f28]">실기 종목</p>
      <ul className="mt-2 space-y-1.5">
        {notice.practical_items.map((item, index) => (
          <li
            key={`${item.category}-${index}`}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl bg-[#f8fbff] px-4 py-2.5"
          >
            <span className="text-[13px] font-black text-[#191f28]">
              {PRACTICAL_LABEL[item.category] ?? item.category}
            </span>
            {item.label && (
              <span className="text-[12px] font-semibold text-[#4e5968]">
                {item.label}
              </span>
            )}
            {item.required === false && (
              <span className="rounded-full bg-[#f2f4f6] px-2 py-0.5 text-[10px] font-black text-[#8b95a1]">
                선택
              </span>
            )}
            <span className="ml-auto flex flex-wrap gap-x-2 text-[12px] font-bold text-[#4e5968]">
              {typeof item.count === "number" && <span>{item.count}편</span>}
              {typeof item.time_limit_sec === "number" && (
                <span>{formatSeconds(item.time_limit_sec)}</span>
              )}
              {typeof item.weight === "number" && <span>{item.weight}%</span>}
              {typeof item.stage === "number" && (
                <span className="text-[#8b95a1]">{item.stage}단계</span>
              )}
            </span>
            {item.note && (
              <p className="w-full text-[12px] font-semibold leading-5 text-[#8b95a1]">
                {item.note}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultTable({ notice }: { notice: AdmissionNotice }) {
  const measured = notice.results.filter((result) => result.competition_rate);

  return (
    <div className="mt-4 rounded-xl border border-[#e5e8eb] p-4">
      <p className="text-[12px] font-black text-[#191f28]">전년도 입시결과</p>
      {measured.length === 0 ? (
        <p className="mt-1 text-[12px] font-semibold leading-5 text-[#8b95a1]">
          {notice.results[0]?.note ?? "대학이 공개하지 않았어요."}
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {measured.map((result) => (
            <div key={`${result.year}-${result.note ?? ""}`}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[12px] font-black text-[#4e5968]">
                  {result.year}학년도
                </span>
                <span className="text-[15px] font-black text-[#191f28]">
                  {result.competition_rate}
                </span>
                {result.transcript_avg && (
                  <span className="text-[12px] font-bold text-[#4e5968]">
                    학생부 평균 {result.transcript_avg}
                    {result.transcript_cut70 && ` · 70%컷 ${result.transcript_cut70}`}
                    {result.transcript_low && ` · 최저 ${result.transcript_low}`}
                  </span>
                )}
                {result.practical_avg && (
                  <span className="rounded bg-[#e8f3ff] px-1.5 py-0.5 text-[12px] font-bold text-[#3182f6]">
                    실기 평균 {result.practical_avg}
                    {result.practical_cut70 && ` · 70%컷 ${result.practical_cut70}`}
                  </span>
                )}
                {result.fill_rate && (
                  <span className="text-[12px] font-bold text-[#4e5968]">
                    충원율 {result.fill_rate}
                  </span>
                )}
                {result.waitlist_last != null && (
                  <span className="text-[12px] font-bold text-[#4e5968]">
                    예비 {result.waitlist_last}번
                  </span>
                )}
                {result.waitlist_count != null && (
                  <span className="text-[12px] font-bold text-[#4e5968]">
                    추가합격 {result.waitlist_count}명
                  </span>
                )}
              </div>
              {result.note && (
                <p className="mt-0.5 text-[11px] font-semibold leading-4 text-[#8b95a1]">
                  {result.note}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 다녀온 사람들이 남긴 실전 정보.
 *
 * 요강에 없는 것만 담는다 — 대기 시간, 고사장 가는 길, 실기실 환경처럼 겪어 봐야
 * 아는 것들이다. 후기 글을 옮긴 게 아니라 거기서 확인한 사실을 다시 쓴 것이고,
 * 원문 링크를 함께 줘서 판단은 읽는 사람이 하게 한다.
 */
function TipList({ tips }: { tips: AdmissionTip[] }) {
  const groups = groupTips(tips);

  return (
    <section className="mt-8">
      <h2 className="text-[15px] font-black text-[#191f28]">먼저 다녀온 사람들 이야기</h2>
      <p className="mt-1 text-[12px] font-semibold leading-5 text-[#8b95a1]">
        요강에 없는 것만 모았어요. 개인 후기에서 확인한 내용이라 저희가 검증한 건
        아니고, 해마다 달라질 수 있어요.
      </p>

      <div className="mt-3 space-y-4">
        {groups.map((group) => (
          <div key={group.category}>
            <p className="text-[12px] font-black text-[#4e5968]">{group.label}</p>
            <ul className="mt-1.5 space-y-1.5">
              {group.items.map((tip, index) => (
                <li
                  key={`${group.category}-${index}`}
                  className="rounded-xl bg-[#f8fbff] px-4 py-3"
                >
                  <p className="text-[13px] font-semibold leading-6 text-[#191f28]">
                    {tip.text}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    {typeof tip.corroborations === "number" &&
                      tip.corroborations > 1 && (
                        <span className="rounded-full bg-[#e8f3ff] px-2 py-0.5 text-[10px] font-black text-[#3182f6]">
                          후기 {tip.corroborations}건에서 확인
                        </span>
                      )}
                    {/* 배지는 '누가 썼나'다. 학원 사이트에 올라온 수험생 글을
                        학원 글로 찍으면 실제보다 신뢰도가 낮아 보인다.
                        올라와 있는 곳은 host로 따로 밝힌다. */}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                        tip.source_type === "official"
                          ? "bg-[#e8f3ff] text-[#3182f6]"
                          : tip.source_type === "academy"
                            ? "bg-[#fff0f0] text-[#e5484d]"
                            : "bg-[#f2f4f6] text-[#8b95a1]"
                      }`}
                    >
                      {SOURCE_LABEL[tip.source_type] ?? tip.source_type}
                    </span>
                    {tip.host && (
                      <span className="text-[10px] font-bold text-[#b0b8c1]">
                        {tip.host}
                      </span>
                    )}
                    {tip.source_url && (
                      <a
                        href={tip.source_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-[11px] font-black text-[#3182f6] hover:underline"
                      >
                        출처 ↗
                      </a>
                    )}
                  </div>
                  {tip.note && (
                    <p className="mt-1 text-[11px] font-semibold leading-4 text-[#8b95a1]">
                      {tip.note}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function ResourceList({ resources }: { resources: AdmissionResource[] }) {
  return (
    <div className="mt-8 border-t border-[#f2f4f6] pt-6">
      <p className="text-[15px] font-black text-[#191f28]">참고 영상</p>
      <p className="mt-1 text-[12px] font-semibold leading-5 text-[#8b95a1]">
        합격했다고 밝힌 영상이 섞여 있어요. 본인 주장이라 저희가 확인한 건 아니고,
        입시학원 홍보 영상도 따로 표시해 뒀어요.
      </p>
      <ul className="mt-3 space-y-2.5">
        {resources.map((resource) => (
          <li key={resource.url}>
            <a
              href={resource.url}
              target="_blank"
              rel="noreferrer noopener"
              className="block rounded-xl bg-[#f8fbff] p-3 hover:bg-[#eef5ff]"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${
                    resource.source_type === "official"
                      ? "bg-[#e8f3ff] text-[#3182f6]"
                      : resource.source_type === "academy"
                        ? "bg-[#fff0f0] text-[#e5484d]"
                        : "bg-[#f2f4f6] text-[#4e5968]"
                  }`}
                >
                  {SOURCE_LABEL[resource.source_type] ?? resource.source_type}
                </span>
                <span className="truncate text-[12px] font-bold text-[#8b95a1]">
                  {resource.publisher}
                </span>
              </div>
              <p className="mt-1.5 text-[13px] font-bold leading-5 text-[#191f28]">
                {resource.title}
              </p>
              {resource.note && (
                <p className="mt-1 text-[12px] font-semibold leading-5 text-[#8b95a1]">
                  {resource.note}
                </p>
              )}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Block({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[12px] font-black text-[#191f28]">{label}</p>
      <p className="mt-1 text-[13px] font-semibold leading-6 text-[#4e5968]">{value}</p>
    </div>
  );
}

/** 120 → "2분", 90 → "1분 30초". 원문이 "2분 이내"인데 "120초"로 보이면 어색하다. */
function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest}초`;
  if (rest === 0) return `${minutes}분`;
  return `${minutes}분 ${rest}초`;
}

function period(start?: string | null, end?: string | null): string | null {
  if (!start && !end) return null;
  if (start && end && start !== end) return `${start} ~ ${end}`;
  return start ?? end ?? null;
}
