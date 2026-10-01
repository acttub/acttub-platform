import Link from "next/link";

import { StoreBadges } from "@/features/app-download/store-badges";
import { ClosingCta, KeywordShell } from "@/features/keyword-pages/keyword-shell";
import type {
  KeywordBlock,
  KeywordPageContent,
} from "@/features/keyword-pages/types";

const practiceHref = "/practice/new";

function Block({ block }: { block: KeywordBlock }) {
  if (block.kind === "p") return <p>{block.text}</p>;
  if (block.kind === "h3") {
    return <h3 className="pt-3 text-xl font-black text-[#191f28]">{block.text}</h3>;
  }
  if (block.kind === "ul") {
    return (
      <ul className="list-disc space-y-2 pl-6">
        {block.items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    );
  }
  if (block.kind === "ol") {
    return (
      <ol className="list-decimal space-y-2 pl-6">
        {block.items.map((item) => <li key={item}>{item}</li>)}
      </ol>
    );
  }
  return (
    <figure className="rounded-3xl bg-[#f2f4f6] p-6">
      <figcaption className="font-black text-[#191f28]">{block.label}</figcaption>
      <div className="mt-3 space-y-2">
        {block.lines.map((line) => <p key={line}>{line}</p>)}
      </div>
    </figure>
  );
}

function StartLinks({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-col items-start ${className}`}>
      <StoreBadges surface="keyword_page" />
      <Link
        href={practiceHref}
        prefetch={false}
        className="mt-4 font-black text-[#3182f6] underline decoration-2 underline-offset-4"
      >
        앱 없이 웹으로 시작하기 →
      </Link>
    </div>
  );
}

export function KeywordPageView({ content }: { content: KeywordPageContent }) {
  return (
    <KeywordShell>
      <article className="mx-auto max-w-3xl px-5 pb-24 pt-14 sm:pt-20">
        <header>
          <p className="text-sm font-black text-[#3182f6]">{content.eyebrow}</p>
          <h1 className="mt-4 break-keep text-4xl font-black leading-[1.18] tracking-[-0.05em] sm:text-6xl">
            {content.h1}
          </h1>
          <div className="mt-7 space-y-4 text-base font-semibold leading-8 text-[#4e5968] sm:text-lg">
            {content.lead.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </div>
          <StartLinks className="mt-8" />
        </header>

        <nav aria-label="목차" className="mt-14 rounded-3xl bg-[#f2f4f6] p-6 sm:p-8">
          <p className="font-black">목차</p>
          <ol className="mt-4 space-y-3 text-[#4e5968]">
            <li>
              <Link href="/guide" className="font-bold hover:text-[#3182f6]">
                연기 연습 가이드
              </Link>
            </li>
            {content.sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="font-bold hover:text-[#3182f6]">
                  {section.heading}
                </a>
              </li>
            ))}
            <li>
              <a href="#faq" className="font-bold hover:text-[#3182f6]">자주 묻는 질문</a>
            </li>
          </ol>
        </nav>

        {content.sections.map((section) => (
          <section key={section.id} id={section.id} className="scroll-mt-8 pt-16">
            <h2 className="break-keep text-3xl font-black tracking-[-0.04em] sm:text-4xl">
              {section.heading}
            </h2>
            <div className="mt-6 space-y-5 text-base leading-8 text-[#4e5968] sm:text-lg">
              {section.blocks.map((block, index) => <Block key={`${block.kind}-${index}`} block={block} />)}
            </div>
          </section>
        ))}

        <section id="faq" className="scroll-mt-8 pt-16">
          <h2 className="text-3xl font-black tracking-[-0.04em] sm:text-4xl">자주 묻는 질문</h2>
          <div className="mt-6 divide-y divide-[#d1d6db] border-y border-[#d1d6db]">
            {content.faq.map((item) => (
              <details key={item.question} className="group py-5">
                <summary className="cursor-pointer list-none pr-5 marker:content-none">
                  <h3 className="inline text-lg font-black leading-7">{item.question}</h3>
                </summary>
                <p className="mt-4 text-base leading-8 text-[#4e5968] sm:text-lg">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <ClosingCta>
          <StartLinks className="mt-7 [&_a:last-child]:text-[#90c2ff]" />
        </ClosingCta>

        <aside aria-label="함께 보기" className="mt-14">
          <h2 className="text-xl font-black">함께 보기</h2>
          <ul className="mt-4 space-y-3">
            {content.related.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="font-bold text-[#3182f6] hover:underline">
                  {link.label} →
                </Link>
              </li>
            ))}
          </ul>
        </aside>
        <p className="mt-12 text-sm font-semibold text-[#8b95a1]">마지막 업데이트 {content.updatedAt}</p>
      </article>
    </KeywordShell>
  );
}
