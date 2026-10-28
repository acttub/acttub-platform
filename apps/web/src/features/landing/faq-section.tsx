import Link from "next/link";

import { findFaq } from "@/features/help/help-content";

import { FOCUS } from "./shared";

const HOME_FAQ = [
  "웹에서도 앱 계정으로 쓸 수 있나요?",
  "무료로 쓰다가 자동으로 유료가 되나요?",
  "어떤 영상을 올릴 수 있나요?",
  "해지하면 바로 Pro를 못 쓰나요?",
  "리딩에는 어떤 대본을 넣을 수 있나요?",
] as const;

export function FaqSection() {
  const faq = HOME_FAQ.map((q) => findFaq(q)).filter((item) => item !== undefined);
  return (
    <section aria-labelledby="faq-title" className="bg-[#fff6e6] text-[#151a30]">
      <div data-reveal className="mx-auto flex max-w-[1200px] flex-col gap-10 px-5 py-20 sm:px-8 lg:flex-row lg:gap-20 lg:py-28">
        <div className="lg:w-[360px]">
          <h2 id="faq-title" className="text-[clamp(32px,5vw,56px)] font-black leading-[1.12] tracking-[-0.055em]">
            자주 묻는 질문
          </h2>
          <div className="mt-7 rounded-[24px] bg-white p-6">
            <p className="text-base font-extrabold">답을 못 찾았나요?</p>
            <p className="mt-1.5 text-sm leading-6 text-[#4e5968]">로그인하지 않아도 문의를 남길 수 있어요.</p>
            <Link href="/help" className={`mt-4 inline-flex h-12 items-center rounded-full bg-[#151a30] px-6 text-[15px] font-bold text-white ${FOCUS}`}>
              고객센터 가기
            </Link>
          </div>
        </div>
        <div className="flex-1">
          {faq.map((item) => (
            <details key={item.q} className="group border-b border-[#151a30]/15">
              <summary className={`flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-lg font-bold sm:text-xl ${FOCUS}`}>
                {item.q}
                <span aria-hidden="true" className="text-[28px] font-normal transition group-open:rotate-45">+</span>
              </summary>
              <p className="pb-5 text-[16px] leading-[1.7] text-[#3d4256]">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
