import Link from "next/link";

import { findFaq } from "@/features/help/help-content";

import { FOCUS, SERIF } from "./shared";

const HOME_FAQ = [
  "웹에서도 앱 계정으로 쓸 수 있나요?",
  "무료로 쓰다가 자동으로 유료가 되나요?",
  "어떤 영상을 올릴 수 있나요?",
  "해지하면 바로 Pro를 못 쓰나요?",
  "리딩에는 어떤 대본을 넣을 수 있나요?",
] as const;

/** 자주 묻는 질문. 요금과 같은 미색 위에서 가는 선으로만 나눈다. */
export function FaqSection() {
  const faq = HOME_FAQ.map((q) => findFaq(q)).filter((item) => item !== undefined);
  return (
    <section aria-labelledby="faq-title" className="bg-[#f3ede3] text-[#1c1814]">
      <div data-reveal className="mx-auto grid max-w-[1200px] gap-12 border-t border-[#1c1814]/12 px-6 py-24 sm:px-8 lg:grid-cols-[360px_minmax(0,1fr)] lg:gap-20 lg:py-32">
        <div>
          <h2 id="faq-title" className={`${SERIF} text-[clamp(32px,4.2vw,54px)] leading-[1.22]`}>
            자주 묻는 질문
          </h2>
          <p className="mt-5 text-[16px] leading-[1.7] text-[#5c5247]">
            답을 못 찾았다면 로그인하지 않아도 문의를 남길 수 있어요.
          </p>
          <Link
            href="/help"
            className={`mt-3 inline-block rounded-sm text-[16px] underline decoration-[#1c1814]/35 underline-offset-[5px] transition-colors hover:decoration-[#1c1814] ${FOCUS}`}
          >
            고객센터
          </Link>
        </div>
        <div className="border-t border-[#1c1814]/80">
          {faq.map((item) => (
            <details key={item.q} className="group border-b border-[#1c1814]/15">
              <summary className={`flex cursor-pointer list-none items-center justify-between gap-6 py-6 text-[17px] font-medium sm:text-[18px] [&::-webkit-details-marker]:hidden ${FOCUS}`}>
                {item.q}
                <span aria-hidden="true" className="relative h-3 w-3 shrink-0">
                  <span className="absolute left-0 top-1/2 h-px w-3 bg-current" />
                  <span className="absolute left-1/2 top-0 h-3 w-px bg-current transition-transform duration-200 group-open:scale-y-0" />
                </span>
              </summary>
              <p className="max-w-[40em] pb-6 text-[16px] leading-[1.75] text-[#5c5247]">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
