"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { FAQ, NOTICES } from "@/features/help/help-content";
import { SiteFooter, SiteHeader } from "@/features/site/site-chrome";

/** 고객센터(/help). 검색은 이 화면에 있는 질문만 걸러 낸다 — 서버 검색은 없다. */
const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4880ee]";

const QUICK = [
  { href: "/help/contact", icon: "✉", title: "문의하기", body: "로그인 없이도 남길 수 있어요" },
  { href: "/pricing", icon: "₩", title: "결제·해지", body: "요금, 다음 결제 해지, 환불 기준" },
  { href: "/login", icon: "→", title: "로그인", body: "앱 계정으로 웹에 로그인" },
  { href: "/account#delete", icon: "✕", title: "계정 삭제", body: "무엇이 지워지는지 먼저 확인" },
] as const;

export function HelpCenter() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");

  const items = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return FAQ.filter((c) => category === "all" || c.id === category).flatMap((c) =>
      c.items
        .filter((item) => words.every((w) => `${item.q} ${item.a}`.toLowerCase().includes(w)))
        .map((item) => ({ ...item, category: c.title })),
    );
  }, [query, category]);

  return (
    <div className="min-h-dvh break-keep bg-white text-[#191f28]">
      <SiteHeader current="help" />
      <main>
        <section className="bg-[#f5f9ff] px-5 pb-8 pt-9 sm:px-8 sm:pb-14 sm:pt-16 sm:text-center">
          <h1 className="text-[28px] font-extrabold tracking-[-0.035em] sm:text-[44px]">무엇을 도와드릴까요?</h1>
          <label className="mx-auto mt-5 flex h-[52px] w-full max-w-[640px] items-center gap-3 rounded-2xl border border-[#e5e8eb] bg-white px-5 shadow-[0_4px_18px_rgba(72,128,238,0.08)] focus-within:border-[#4880ee] sm:mt-6 sm:h-[60px]">
            <span aria-hidden="true" className="text-lg text-[#8b95a1]">⌕</span>
            <span className="sr-only">자주 묻는 질문 검색</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="궁금한 내용을 검색해 보세요 (예: 환불, 로그인)"
              className="h-full w-full bg-transparent text-[15px] outline-none placeholder:text-[#8b95a1] sm:text-[17px]"
            />
          </label>
        </section>

        <ul className="mx-auto grid max-w-[1120px] grid-cols-2 gap-2.5 px-5 pt-6 sm:gap-4 sm:px-8 sm:pt-10 lg:grid-cols-4">
          {QUICK.map((q) => (
            <li key={q.title}>
              <Link href={q.href} className={`block h-full rounded-[20px] border border-[#e5e8eb] p-4 transition hover:border-[#cbd1d8] sm:p-[22px] ${FOCUS}`}>
                <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#eaf3fe] font-extrabold text-[#4880ee] sm:h-11 sm:w-11">
                  {q.icon}
                </span>
                <span className="mt-3 block text-[15.5px] font-extrabold sm:mt-3.5 sm:text-[17px]">{q.title}</span>
                <span className="mt-1 hidden text-sm leading-5 text-[#6b7684] sm:block">{q.body}</span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="mx-auto flex max-w-[1120px] flex-col gap-8 px-5 pb-16 pt-8 sm:px-8 sm:pt-10 lg:flex-row lg:gap-14 lg:pb-20">
          <section id="faq" aria-labelledby="faq-title" className="flex-1 scroll-mt-24">
            <h2 id="faq-title" className="text-xl font-extrabold sm:text-2xl">자주 묻는 질문</h2>
            <div role="group" aria-label="질문 분류" className="mt-4 flex flex-wrap gap-2">
              {[{ id: "all", title: "전체" }, ...FAQ].map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={category === c.id}
                  onClick={() => setCategory(c.id)}
                  className={`rounded-full px-4 py-2.5 text-[15px] font-bold transition aria-pressed:bg-[#191f28] aria-pressed:text-white ${category === c.id ? "" : "bg-[#f2f4f6] text-[#4e5968] hover:bg-[#e5e8eb]"} ${FOCUS}`}
                >
                  {c.title}
                </button>
              ))}
            </div>
            {items.length === 0 ? (
              <p className="mt-8 rounded-2xl bg-[#f9fafb] p-5 text-[15px] leading-6 text-[#4e5968]">
                찾는 질문이 없어요.{" "}
                <Link href="/help/contact" className={`rounded font-bold text-[#3268d8] underline underline-offset-2 ${FOCUS}`}>
                  문의를 남겨 주세요
                </Link>
              </p>
            ) : (
              <div className="mt-3">
                {items.map((item) => (
                  <details key={item.q} className="group border-b border-[#e5e8eb]">
                    <summary className={`flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-base font-bold sm:text-lg ${FOCUS}`}>
                      {item.q}
                      <span aria-hidden="true" className="text-[22px] font-normal text-[#8b95a1] transition group-open:rotate-45">+</span>
                    </summary>
                    <div className="pb-5">
                      <p className="text-[15.5px] leading-[1.65] text-[#4e5968]">{item.a}</p>
                      {item.href ? (
                        <Link href={item.href} className={`mt-2 inline-block rounded text-sm font-bold text-[#3268d8] ${FOCUS}`}>
                          {item.hrefLabel} →
                        </Link>
                      ) : null}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </section>

          <aside className="flex flex-col gap-5 lg:w-[340px]">
            <section id="notice" aria-labelledby="notice-title" className="scroll-mt-24 rounded-[20px] border border-[#e5e8eb] p-[22px]">
              <h2 id="notice-title" className="text-base font-extrabold">공지</h2>
              <ul>
                {NOTICES.map((n) => (
                  <li key={n.date + n.title} className="border-b border-[#edf0f3] py-4 last:border-0 last:pb-0">
                    <p className="text-[13px] text-[#8b95a1]">{n.date}</p>
                    <p className="mt-1 text-[15.5px] font-bold">{n.title}</p>
                    <p className="mt-1 text-sm leading-6 text-[#4e5968]">{n.body}</p>
                    {n.href ? (
                      <Link href={n.href} className={`mt-1 inline-block rounded text-sm font-bold text-[#3268d8] ${FOCUS}`}>
                        자세히 보기 →
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-[20px] bg-[#1e2430] p-6 text-white">
              <h2 className="text-lg font-extrabold">답을 못 찾았나요?</h2>
              <p className="mt-1.5 text-sm leading-6 text-[#b9c1cc]">유형을 고르고 회신 받을 이메일과 내용을 남겨 주세요. 로그인하지 않아도 돼요.</p>
              <Link href="/help/contact" className={`mt-4 inline-flex h-11 items-center rounded-xl bg-[#4880ee] px-[18px] text-[15px] font-bold text-white ${FOCUS}`}>
                문의 남기기
              </Link>
            </section>
            <section className="rounded-[20px] border border-[#e5e8eb] p-[22px]">
              <h2 className="text-base font-extrabold">내 계정</h2>
              <p className="mt-1.5 text-sm leading-6 text-[#6b7684]">로그아웃과 탈퇴는 로그인한 뒤 내 계정에서 할 수 있어요.</p>
              <Link href="/account" className={`mt-3 inline-flex h-10 items-center rounded-xl border border-[#e5e8eb] px-3.5 text-sm font-bold text-[#333d4b] ${FOCUS}`}>
                내 계정 보기
              </Link>
            </section>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
