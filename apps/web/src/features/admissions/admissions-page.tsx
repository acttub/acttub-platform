"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  activeFilterCount,
  availableFacets,
  countdown,
  filterGroups,
  getAdmissions,
  groupByUniversity,
  DISCIPLINE_LABEL,
  EMPTY_FILTERS,
  PRACTICAL_LABEL,
  type AdmissionFilters,
  type AdmissionNotice,
  type AdmissionsResponse,
  type AdmissionUniversity,
} from "@/lib/api/v2/admissions";
import { RailLayout } from "@/features/nav/app-rail";

const TYPE_LABEL: Record<string, string> = {
  univ: "4년제",
  college: "전문대",
};

export function AdmissionsPage() {
  const [payload, setPayload] = useState<AdmissionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const [filters, setFilters] = useState<AdmissionFilters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);

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
  const facets = useMemo(
    () => (payload ? availableFacets(payload) : null),
    [payload],
  );

  const visible = useMemo(
    () => filterGroups(groups, filters, today),
    [groups, filters, today],
  );
  const activeCount = activeFilterCount(filters);

  /** 필터 축 하나를 켜고 끈다. 같은 축 안에서는 여러 개를 고를 수 있다(OR). */
  const toggle = (
    axis: "regions" | "tracks" | "disciplines" | "practicals" | "types",
    value: string,
  ) =>
    setFilters((was) => ({
      ...was,
      [axis]: was[axis].includes(value)
        ? was[axis].filter((v) => v !== value)
        : [...was[axis], value],
    }));

  // 마감이 가까운 순으로 이미 정렬돼 있다. 맨 앞 셋만 크게 띄운다.
  const upcoming = groups
    .flatMap(({ university, notices }) =>
      notices.map((notice) => ({ university, notice })),
    )
    .filter(({ notice }) => today && countdown(notice, today))
    .slice(0, 3);

  return (
    <RailLayout>
      <main className="min-h-dvh">
      <div className="mx-auto w-full max-w-[760px] px-5 py-10">
        <h1 className="text-[26px] font-black tracking-[-0.03em] text-[#191f28]">
          연기 입시 정보
        </h1>
        <p className="mt-2 text-sm font-semibold leading-6 text-[#4e5968]">
          연기·뮤지컬 실기 전형만 모았어요. 각 대학 모집요강 원문을 사람이 직접 읽고
          채우고 있어요.
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
                value={filters.query}
                onChange={(event) =>
                  setFilters((was) => ({ ...was, query: event.target.value }))
                }
                placeholder="대학·학과·지역 검색"
                className="min-w-[200px] flex-1 rounded-xl border border-[#e5e8eb] bg-white px-4 py-2.5 text-[14px] font-semibold text-[#191f28] outline-none placeholder:text-[#b0b8c1] focus:border-[#3182f6]"
              />
              <button
                type="button"
                onClick={() =>
                  setFilters((was) => ({ ...was, openOnly: !was.openOnly }))
                }
                className={`rounded-xl px-4 py-2.5 text-[13px] font-black ${
                  filters.openOnly
                    ? "bg-[#3182f6] text-white"
                    : "border border-[#e5e8eb] bg-white text-[#4e5968]"
                }`}
              >
                접수 가능만
              </button>
              <button
                type="button"
                onClick={() => setFilterOpen((was) => !was)}
                className={`rounded-xl px-4 py-2.5 text-[13px] font-black ${
                  activeCount > 0
                    ? "bg-[#191f28] text-white"
                    : "border border-[#e5e8eb] bg-white text-[#4e5968]"
                }`}
              >
                필터{activeCount > 0 ? ` ${activeCount}` : ""}
              </button>
            </div>

            {filterOpen && facets && (
              <div className="mt-2 space-y-3 rounded-2xl border border-[#e5e8eb] bg-white p-4">
                <FilterRow label="지역" values={facets.regions}>
                  {facets.regions.map((region) => (
                    <Chip
                      key={region}
                      label={region}
                      on={filters.regions.includes(region)}
                      onClick={() => toggle("regions", region)}
                    />
                  ))}
                </FilterRow>
                <FilterRow label="전형" values={facets.tracks}>
                  {facets.tracks.map((track) => (
                    <Chip
                      key={track}
                      label={track}
                      on={filters.tracks.includes(track)}
                      onClick={() => toggle("tracks", track)}
                    />
                  ))}
                </FilterRow>
                <FilterRow label="계열" values={facets.disciplines}>
                  {facets.disciplines.map((discipline) => (
                    <Chip
                      key={discipline}
                      label={DISCIPLINE_LABEL[discipline] ?? discipline}
                      on={filters.disciplines.includes(discipline)}
                      onClick={() => toggle("disciplines", discipline)}
                    />
                  ))}
                </FilterRow>
                <FilterRow label="실기 종목" values={facets.practicals}>
                  {facets.practicals.map((category) => (
                    <Chip
                      key={category}
                      label={PRACTICAL_LABEL[category] ?? category}
                      on={filters.practicals.includes(category)}
                      onClick={() => toggle("practicals", category)}
                    />
                  ))}
                </FilterRow>
                <FilterRow label="학교" values={["always"]}>
                  {facets.types.map((type) => (
                    <Chip
                      key={type}
                      label={TYPE_LABEL[type] ?? type}
                      on={filters.types.includes(type)}
                      onClick={() => toggle("types", type)}
                    />
                  ))}
                  <Chip
                    label="수능 최저 없음"
                    on={filters.noCsatOnly}
                    onClick={() =>
                      setFilters((was) => ({ ...was, noCsatOnly: !was.noCsatOnly }))
                    }
                  />
                </FilterRow>
                {activeCount > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setFilters((was) => ({ ...EMPTY_FILTERS, query: was.query }))
                    }
                    className="text-[12px] font-black text-[#3182f6] hover:underline"
                  >
                    필터 초기화
                  </button>
                )}
              </div>
            )}

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

        </div>
      </main>
    </RailLayout>
  );
}

/**
 * 목록 카드. 대학이 쉰 곳이라 여기서 펼치지 않고 상세 페이지로 보낸다 —
 * 아코디언 두 겹으로는 훑을 수도, 링크를 공유할 수도 없었다.
 */
function UniversityCard({
  university,
  notices,
  today,
}: {
  university: AdmissionUniversity;
  notices: AdmissionNotice[];
  today: string | null;
}) {
  const soonest = notices
    .map((notice) => (today ? countdown(notice, today) : null))
    .filter(Boolean)
    .sort((a, b) => (a?.days ?? 0) - (b?.days ?? 0))[0];

  const departments = notices
    .map((notice) => notice.department ?? "학과 미확인")
    // 같은 학과가 수시·정시로 두 번 잡히면 한 줄에 같은 이름이 두 번 뜬다.
    .filter((name, index, all) => all.indexOf(name) === index);

  return (
    <Link
      href={`/admissions/${university.id}`}
      className="flex items-center gap-3 rounded-2xl border border-[#e5e8eb] bg-white px-5 py-4 hover:border-[#3182f6]"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate text-[17px] font-black text-[#191f28]">
            {university.name}
          </h2>
          {university.campus && (
            <span className="shrink-0 rounded-full bg-[#f2f4f6] px-2 py-0.5 text-[11px] font-black text-[#4e5968]">
              {university.campus}
            </span>
          )}
          {university.region && (
            <span className="shrink-0 text-[12px] font-bold text-[#8b95a1]">
              {university.region}
            </span>
          )}
        </div>
        <p className="mt-1 truncate text-[12px] font-semibold text-[#8b95a1]">
          {departments.length > 0 ? departments.join(" · ") : "전형 정보 확인 중"}
          {university.resources.length > 0 && ` · 영상 ${university.resources.length}`}
        </p>
      </div>
      {soonest && (
        <span className="shrink-0 rounded-full bg-[#191f28] px-2.5 py-1 text-[11px] font-black text-white">
          D-{soonest.days === 0 ? "DAY" : soonest.days}
        </span>
      )}
      <span className="shrink-0 text-[12px] font-black text-[#b0b8c1]">›</span>
    </Link>
  );
}

/**
 * 필터 한 줄. `values`가 비면 통째로 감춘다 — 아직 공고를 확인하지 못한 대학이
 * 대부분이라 실기 종목 facet이 빌 수 있는데, 라벨만 남은 빈 줄은 고장으로 읽힌다.
 */
function FilterRow({
  label,
  values,
  children,
}: {
  label: string;
  values: unknown[];
  children: React.ReactNode;
}) {
  if (values.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="w-[64px] shrink-0 text-[12px] font-black text-[#8b95a1]">
        {label}
      </span>
      {children}
    </div>
  );
}

function Chip({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full px-3 py-1.5 text-[12px] font-black ${
        on ? "bg-[#3182f6] text-white" : "bg-[#f2f4f6] text-[#4e5968]"
      }`}
    >
      {label}
    </button>
  );
}

/** 사용자가 사는 시간대의 오늘. UTC로 자르면 한국 오전에 하루가 밀린다. */
function localDate(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
