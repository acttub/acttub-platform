import Link from "next/link";
import { BusinessInfo } from "@/features/business-info/business-info";
import { FAQ, NOTICES } from "@/features/help/help-content";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("고객센터");

export default function HelpPage() {
  return (
    <div className="min-h-dvh break-keep bg-[#f2f4f6] text-[#191f28]">
      <header className="bg-white px-5 py-4 ring-1 ring-[#e5e8eb] sm:px-8">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link href="/" className="text-lg font-black tracking-[-0.02em]">ACTTUB</Link>
          <Link href="/help/contact" className="rounded-full bg-[#191f28] px-4 py-2 text-sm font-bold text-white">문의하기</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-6 px-5 py-10 sm:px-8">
        <h1 className="text-3xl font-black tracking-[-0.03em]">고객센터</h1>

        <section aria-labelledby="notice-title" className="rounded-[28px] bg-white p-6 ring-1 ring-[#e5e8eb] sm:p-8">
          <h2 id="notice-title" className="text-xl font-black">공지</h2>
          <ul className="mt-4 divide-y divide-[#f2f4f6]">
            {NOTICES.map((n) => (
              <li key={n.date + n.title} className="py-3">
                <p className="text-xs text-[#8b95a1]">{n.date}</p>
                <p className="mt-1 font-bold">{n.title}</p>
                <p className="mt-1 text-sm leading-6 text-[#4e5968]">{n.body}</p>
                {n.href ? (
                  <Link href={n.href} className="mt-1 inline-block text-sm font-semibold text-[#3182f6]">자세히 보기</Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="faq-title" className="rounded-[28px] bg-white p-6 ring-1 ring-[#e5e8eb] sm:p-8">
          <h2 id="faq-title" className="text-xl font-black">자주 묻는 질문</h2>
          <nav aria-label="질문 분류" className="mt-4 flex flex-wrap gap-2">
            {FAQ.map((c) => (
              <a key={c.id} href={`#${c.id}`} className="rounded-full bg-[#f2f4f6] px-3 py-1.5 text-sm font-semibold text-[#4e5968]">
                {c.title}
              </a>
            ))}
          </nav>
          {FAQ.map((c) => (
            <div key={c.id} id={c.id} className="mt-8 scroll-mt-6">
              <h3 className="text-base font-black">{c.title}</h3>
              <div className="mt-2 divide-y divide-[#f2f4f6]">
                {c.items.map((item) => (
                  <details key={item.q} className="group py-3">
                    <summary className="cursor-pointer list-none font-semibold">{item.q}</summary>
                    <p className="mt-2 text-sm leading-6 text-[#4e5968]">{item.a}</p>
                    {item.href ? (
                      <Link href={item.href} className="mt-1 inline-block text-sm font-semibold text-[#3182f6]">{item.hrefLabel}</Link>
                    ) : null}
                  </details>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className="rounded-[28px] bg-[#191f28] p-6 text-white sm:p-8">
          <h2 className="text-xl font-black">찾는 답이 없나요?</h2>
          <p className="mt-2 text-sm leading-6 text-[#d1d6db]">로그인하지 않아도 문의할 수 있어요.</p>
          <Link href="/help/contact" className="mt-4 inline-block rounded-full bg-white px-5 py-2.5 text-sm font-bold text-[#191f28]">문의하기</Link>
        </section>

        <footer className="pt-4"><BusinessInfo /></footer>
      </main>
    </div>
  );
}
