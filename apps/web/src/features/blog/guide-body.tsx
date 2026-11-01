import { findGuide } from "@/features/keyword-pages/content/guide/index";
import type { KeywordBlock } from "@/features/keyword-pages/types";

// 기존 가이드의 구조화 본문(섹션·블록·FAQ)을 새 글 레이아웃 안에 그린다.
function Block({ block }: { block: KeywordBlock }) {
  if (block.kind === "p") return <p>{block.text}</p>;
  if (block.kind === "h3") return <h3 className="pt-3 text-xl font-black text-[#191f28]">{block.text}</h3>;
  if (block.kind === "ul") {
    return <ul className="list-disc space-y-2 pl-6">{block.items.map((item) => <li key={item}>{item}</li>)}</ul>;
  }
  if (block.kind === "ol") {
    return <ol className="list-decimal space-y-2 pl-6">{block.items.map((item) => <li key={item}>{item}</li>)}</ol>;
  }
  return (
    <figure className="rounded-2xl bg-[#f2f4f6] p-6">
      <figcaption className="font-black text-[#191f28]">{block.label}</figcaption>
      <div className="mt-3 space-y-2">{block.lines.map((line) => <p key={line}>{line}</p>)}</div>
    </figure>
  );
}

export function GuideBody({ slug }: { slug: string }) {
  const guide = findGuide(slug);
  if (!guide) return null;
  return (
    <>
      {guide.lead.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      {guide.sections.map((section) => (
        <section key={section.id} id={section.id} className="scroll-mt-8 space-y-5">
          <h2 className="break-keep pt-8 text-2xl font-black tracking-[-0.03em] text-[#191f28]">{section.heading}</h2>
          {section.blocks.map((block, index) => <Block key={`${block.kind}-${index}`} block={block} />)}
        </section>
      ))}
      {guide.faq.length > 0 && (
        <section id="faq" className="scroll-mt-8 space-y-5">
          <h2 className="pt-8 text-2xl font-black tracking-[-0.03em] text-[#191f28]">자주 묻는 질문</h2>
          <div className="divide-y divide-[#e5e8eb] border-y border-[#e5e8eb]">
            {guide.faq.map((item) => (
              <div key={item.question} className="py-5">
                <h3 className="text-lg font-black leading-7 text-[#191f28]">{item.question}</h3>
                <p className="mt-3">{item.answer}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
