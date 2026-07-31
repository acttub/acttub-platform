"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  getAdmissions,
  groupByUniversity,
  type AdmissionNotice,
  type AdmissionsResponse,
} from "@/lib/api/v2/admissions";

export function AdmissionsPage() {
  const [payload, setPayload] = useState<AdmissionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getAdmissions({ signal: controller.signal })
      .then(setPayload)
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof Error ? cause.message : "입시 정보를 불러오지 못했어요.",
        );
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="min-h-dvh bg-[#f8fbff]">
      <div className="mx-auto w-full max-w-[720px] px-5 py-10">
        <h1 className="text-[26px] font-black tracking-[-0.03em] text-[#191f28]">
          연기 입시 정보
        </h1>
        <p className="mt-2 text-sm font-semibold leading-6 text-[#4e5968]">
          연극영화 계열 실기 전형 일정을 모았어요. 각 대학 입학처 공고를 사람이 직접 확인해
          채우고 있어요.
        </p>

        {payload && (
          <p className="mt-4 rounded-2xl bg-[#fff4e6] px-4 py-3 text-[13px] font-bold leading-5 text-[#b45309]">
            ⓘ {payload.disclaimer}
          </p>
        )}

        {error && (
          <p className="mt-8 text-sm font-semibold text-[#e5484d]">{error}</p>
        )}

        {!payload && !error && (
          <p className="mt-8 text-sm font-semibold text-[#8b95a1]">불러오는 중이에요…</p>
        )}

        {payload && (
          <>
            <div className="mt-6 space-y-3">
              {groupByUniversity(payload).map(({ university, notices }) => (
                <section
                  key={university.id}
                  className="rounded-2xl border border-[#e5e8eb] bg-white p-5"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-[17px] font-black text-[#191f28]">
                      {university.name}
                    </h2>
                    <a
                      href={university.admission_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="shrink-0 text-[13px] font-black text-[#3182f6] hover:underline"
                    >
                      입학처 ↗
                    </a>
                  </div>

                  {notices.length === 0 ? (
                    <p className="mt-3 text-[13px] font-semibold leading-5 text-[#8b95a1]">
                      {university.note ??
                        "아직 전형 정보를 확인하지 못했어요. 입학처에서 확인해 주세요."}
                    </p>
                  ) : (
                    <ul className="mt-4 space-y-4">
                      {notices.map((notice) => (
                        <NoticeRow key={notice.id} notice={notice} />
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>

            <p className="mt-8 text-[12px] font-semibold text-[#8b95a1]">
              {payload.updated_at} 기준 · 확인한 곳부터 차례로 채우고 있어요
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

function NoticeRow({ notice }: { notice: AdmissionNotice }) {
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
      </div>

      {notice.screening && (
        <p className="mt-1 text-[13px] font-bold text-[#4e5968]">{notice.screening}</p>
      )}

      <dl className="mt-3 space-y-1.5 text-[13px] font-semibold text-[#4e5968]">
        <Row label="원서접수" value={period(notice.apply_start, notice.apply_end)} />
        <Row label="실기고사" value={notice.practical_date} />
        <Row label="실기 과제" value={notice.practical_task} />
      </dl>

      {notice.note && (
        <p className="mt-3 text-[12px] font-semibold leading-5 text-[#8b95a1]">
          {notice.note}
        </p>
      )}

      {notice.source_url && (
        <a
          href={notice.source_url}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-3 inline-block text-[12px] font-black text-[#3182f6] hover:underline"
        >
          원문 공고 보기 ↗
        </a>
      )}
    </li>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex gap-3">
      <dt className="w-[64px] shrink-0 text-[#8b95a1]">{label}</dt>
      <dd className="min-w-0 flex-1">{value || "확인 필요"}</dd>
    </div>
  );
}

function period(start?: string | null, end?: string | null): string | null {
  if (!start && !end) return null;
  if (start && end) return `${start} ~ ${end}`;
  return start ?? end ?? null;
}
