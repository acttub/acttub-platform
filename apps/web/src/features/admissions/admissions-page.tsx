"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  countdown,
  getAdmissions,
  groupByUniversity,
  isOpen,
  matchesQuery,
  SOURCE_LABEL,
  type AdmissionNotice,
  type AdmissionResource,
  type AdmissionsResponse,
  type AdmissionUniversity,
} from "@/lib/api/v2/admissions";

export function AdmissionsPage() {
  const [payload, setPayload] = useState<AdmissionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openOnly, setOpenOnly] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getAdmissions({ signal: controller.signal })
      .then((data) => {
        // 정적 export라 서버 시각이 없다. 응답이 온 뒤에 읽어 프리렌더와 어긋나지 않게 한다.
        setToday(localDate());
        setPayload(data);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof Error ? cause.message : "입시 정보를 불러오지 못했어요.",
        );
      });
    return () => controller.abort();
  }, []);

  const groups = useMemo(
    () => (payload ? groupByUniversity(payload, today) : []),
    [payload, today],
  );

  const visible = groups.filter(({ university, notices }) => {
    if (!matchesQuery(university, notices, query)) return false;
    if (!openOnly) return true;
    return notices.some((notice) => today && isOpen(notice, today));
  });

  // 마감이 가까운 순으로 이미 정렬돼 있다. 맨 앞 셋만 크게 띄운다.
  const upcoming = groups
    .flatMap(({ university, notices }) =>
      notices.map((notice) => ({ university, notice })),
    )
    .filter(({ notice }) => today && countdown(notice, today))
    .slice(0, 3);

  return (
    <main className="min-h-dvh bg-[#f8fbff]">
      <div className="mx-auto w-full max-w-[760px] px-5 py-10">
        <h1 className="text-[26px] font-black tracking-[-0.03em] text-[#191f28]">
          연기 입시 정보
        </h1>
        <p className="mt-2 text-sm font-semibold leading-6 text-[#4e5968]">
          서울·경기 연극영화 계열 실기 전형을 모았어요. 각 대학 모집요강 원문을 사람이
          직접 읽고 채우고 있어요.
        </p>

        {payload && (
          <p className="mt-4 rounded-2xl bg-[#fff4e6] px-4 py-3 text-[13px] font-bold leading-5 text-[#b45309]">
            ⓘ {payload.disclaimer}
          </p>
        )}

        {error && <p className="mt-8 text-sm font-semibold text-[#e5484d]">{error}</p>}

        {!payload && !error && (
          <p className="mt-8 text-sm font-semibold text-[#8b95a1]">불러오는 중이에요…</p>
        )}

        {payload && (
          <>
            {upcoming.length > 0 && (
              <section className="mt-6">
                <h2 className="text-[13px] font-black text-[#8b95a1]">다가오는 마감</h2>
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  {upcoming.map(({ university, notice }) => {
                    const remaining = countdown(notice, today as string);
                    return (
                      <div
                        key={notice.id}
                        className="min-w-[168px] flex-1 rounded-2xl bg-[#191f28] px-4 py-3 text-white"
                      >
                        <p className="text-[11px] font-bold text-[#b0b8c1]">
                          {remaining?.label}
                        </p>
                        <p className="mt-0.5 text-[22px] font-black leading-none">
                          D-{remaining?.days === 0 ? "DAY" : remaining?.days}
                        </p>
                        <p className="mt-2 truncate text-[12px] font-black">
                          {university.name}
                        </p>
                        <p className="truncate text-[11px] font-semibold text-[#b0b8c1]">
                          {notice.department ?? ""}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="대학·학과·지역 검색"
                className="min-w-[200px] flex-1 rounded-xl border border-[#e5e8eb] bg-white px-4 py-2.5 text-[14px] font-semibold text-[#191f28] outline-none placeholder:text-[#b0b8c1] focus:border-[#3182f6]"
              />
              <button
                type="button"
                onClick={() => setOpenOnly((was) => !was)}
                className={`rounded-xl px-4 py-2.5 text-[13px] font-black ${
                  openOnly
                    ? "bg-[#3182f6] text-white"
                    : "border border-[#e5e8eb] bg-white text-[#4e5968]"
                }`}
              >
                접수 가능만
              </button>
            </div>

            <p className="mt-3 text-[12px] font-bold text-[#8b95a1]">
              대학 {visible.length}곳
            </p>

            <div className="mt-2 space-y-3">
              {visible.map(({ university, notices }) => (
                <UniversityCard
                  key={university.id}
                  university={university}
                  notices={notices}
                  today={today}
                />
              ))}
              {visible.length === 0 && (
                <p className="py-10 text-center text-sm font-semibold text-[#8b95a1]">
                  조건에 맞는 대학이 없어요.
                </p>
              )}
            </div>

            <p className="mt-8 text-[12px] font-semibold leading-5 text-[#8b95a1]">
              {payload.updated_at} 기준 · 확인한 곳부터 차례로 채우고 있어요
              <br />
              입시결과에 적힌 학생부 숫자는 최종등록자의 교과 성적이에요. 실기 성적은
              대부분의 대학이 공개하지 않지만, 공개한 곳은 함께 적어 뒀어요.
            </p>
          </>
        )}

        <Link
          href="/"
          className="mt-8 inline-block text-[13px] font-black text-[#3182f6] hover:underline"
        >
          ← 홈으로
        </Link>
      </div>
    </main>
  );
}

function UniversityCard({
  university,
  notices,
  today,
}: {
  university: AdmissionUniversity;
  notices: AdmissionNotice[];
  today: string | null;
}) {
  // 대학이 열다섯 곳이라 전부 펼쳐 두면 훑을 수가 없다.
  const [open, setOpen] = useState(false);
  const soonest = notices
    .map((notice) => (today ? countdown(notice, today) : null))
    .filter(Boolean)
    .sort((a, b) => (a?.days ?? 0) - (b?.days ?? 0))[0];

  return (
    <section className="overflow-hidden rounded-2xl border border-[#e5e8eb] bg-white">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[17px] font-black text-[#191f28]">
              {university.name}
            </h2>
            {university.region && (
              <span className="shrink-0 text-[12px] font-bold text-[#8b95a1]">
                {university.region}
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-[12px] font-semibold text-[#8b95a1]">
            {notices.length > 0
              ? notices.map((n) => n.department ?? "학과 미확인").join(" · ")
              : "전형 정보 확인 중"}
            {university.resources.length > 0 && ` · 영상 ${university.resources.length}`}
          </p>
        </div>
        {soonest && (
          <span className="shrink-0 rounded-full bg-[#191f28] px-2.5 py-1 text-[11px] font-black text-white">
            D-{soonest.days === 0 ? "DAY" : soonest.days}
          </span>
        )}
        <span className="shrink-0 text-[12px] font-black text-[#b0b8c1]">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="border-t border-[#f2f4f6] px-5 pb-5 pt-4">
          <a
            href={university.admission_url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[13px] font-black text-[#3182f6] hover:underline"
          >
            입학처 원문 ↗
          </a>

          {notices.length === 0 ? (
            <p className="mt-3 text-[13px] font-semibold leading-5 text-[#8b95a1]">
              {university.note ??
                "아직 전형 정보를 확인하지 못했어요. 입학처에서 확인해 주세요."}
            </p>
          ) : (
            <ul className="mt-4 space-y-4">
              {notices.map((notice) => (
                <NoticeRow key={notice.id} notice={notice} today={today} />
              ))}
            </ul>
          )}

          {university.resources.length > 0 && (
            <ResourceList resources={university.resources} />
          )}
        </div>
      )}
    </section>
  );
}

function ResourceList({ resources }: { resources: AdmissionResource[] }) {
  return (
    <div className="mt-5 border-t border-[#f2f4f6] pt-4">
      <p className="text-[13px] font-black text-[#191f28]">참고 영상</p>
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

function NoticeRow({
  notice,
  today,
}: {
  notice: AdmissionNotice;
  today: string | null;
}) {
  const [open, setOpen] = useState(false);
  const remaining = today ? countdown(notice, today) : null;
  const closed = Boolean(today) && !isOpen(notice, today as string);

  return (
    <li className="rounded-xl bg-[#f8fbff] p-4">
      <div className="flex flex-wrap items-center gap-2">
        {notice.track && (
          <span className="rounded-full bg-[#e8f3ff] px-2.5 py-1 text-[11px] font-black text-[#3182f6]">
            {notice.track}
          </span>
        )}
        <span className="text-[15px] font-black text-[#191f28]">
          {notice.department ?? "학과 미확인"}
        </span>
        {notice.quota && (
          <span className="text-[12px] font-bold text-[#8b95a1]">{notice.quota}</span>
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

      {notice.screening && (
        <p className="mt-1 text-[13px] font-bold text-[#4e5968]">{notice.screening}</p>
      )}

      <dl className="mt-3 space-y-1.5 text-[13px] font-semibold text-[#4e5968]">
        <Row label="원서접수" value={period(notice.apply_start, notice.apply_end)} />
        <Row label="실기고사" value={notice.practical_date} />
        <Row label="전형료" value={notice.fee} />
        <Row label="수능 최저" value={notice.csat_minimum} />
      </dl>

      {notice.results.length > 0 && <ResultTable notice={notice} />}

      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        className="mt-3 text-[12px] font-black text-[#3182f6] hover:underline"
      >
        {open ? "실기 내용 접기" : "실기 내용·준비물 자세히 보기"}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <Block label="실기 과제" value={notice.practical_task} />
          <Block label="복장·준비물" value={notice.dress_code} />
          <Block label="제출서류" value={notice.documents} />

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

          {notice.note && (
            <p className="text-[12px] font-semibold leading-5 text-[#8b95a1]">
              {notice.note}
            </p>
          )}
        </div>
      )}

      {notice.source_url && (
        <a
          href={notice.source_url}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-3 block text-[12px] font-black text-[#3182f6] hover:underline"
        >
          원문 공고 보기 ↗
        </a>
      )}
    </li>
  );
}

function ResultTable({ notice }: { notice: AdmissionNotice }) {
  const measured = notice.results.filter((result) => result.competition_rate);

  return (
    <div className="mt-3 rounded-lg bg-white p-3">
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

function Block({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[12px] font-black text-[#191f28]">{label}</p>
      <p className="mt-1 text-[13px] font-semibold leading-5 text-[#4e5968]">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex gap-3">
      <dt className="w-[64px] shrink-0 text-[#8b95a1]">{label}</dt>
      <dd className="min-w-0 flex-1">{value}</dd>
    </div>
  );
}

/** 사용자가 사는 시간대의 오늘. UTC로 자르면 한국 오전에 하루가 밀린다. */
function localDate(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function period(start?: string | null, end?: string | null): string | null {
  if (!start && !end) return null;
  if (start && end) return `${start} ~ ${end}`;
  return start ?? end ?? null;
}
