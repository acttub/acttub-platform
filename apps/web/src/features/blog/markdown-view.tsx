import type { ReactNode } from "react";

import { type Inline, type MdBlock, parseMarkdown } from "./markdown";

function renderInline(nodes: readonly Inline[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.t) {
      case "text": return node.text;
      case "strong": return <strong key={index} className="font-black text-[#191f28]">{renderInline(node.children)}</strong>;
      case "em": return <em key={index}>{renderInline(node.children)}</em>;
      case "code": return <code key={index} className="rounded bg-[#f2f4f6] px-1.5 py-0.5 text-[0.9em]">{node.text}</code>;
      case "image":
        // eslint-disable-next-line @next/next/no-img-element
        return <img key={index} src={node.src} alt={node.alt} loading="lazy" className="my-2 h-auto max-w-full rounded-2xl" />;
      case "link": {
        const external = /^https?:\/\//i.test(node.href);
        const className = "font-bold text-[#3182f6] underline underline-offset-4";
        return external ? (
          <a key={index} href={node.href} rel="noopener noreferrer nofollow" target="_blank" className={className}>
            {renderInline(node.children)}
          </a>
        ) : (
          <a key={index} href={node.href} className={className}>{renderInline(node.children)}</a>
        );
      }
    }
  });
}

function renderBlock(block: MdBlock, index: number): ReactNode {
  switch (block.t) {
    case "heading":
      return block.depth === 2
        ? <h2 key={index} className="break-keep pt-8 text-2xl font-black tracking-[-0.03em] text-[#191f28]">{renderInline(block.children)}</h2>
        : <h3 key={index} className="break-keep pt-4 text-xl font-black text-[#191f28]">{renderInline(block.children)}</h3>;
    case "p": return <p key={index}>{renderInline(block.children)}</p>;
    case "ul": return <ul key={index} className="list-disc space-y-2 pl-6">{block.items.map((item, n) => <li key={n}>{renderInline(item)}</li>)}</ul>;
    case "ol": return <ol key={index} className="list-decimal space-y-2 pl-6">{block.items.map((item, n) => <li key={n}>{renderInline(item)}</li>)}</ol>;
    case "quote": return <blockquote key={index} className="border-l-4 border-[#e5e8eb] pl-4 text-[#4e5968]">{renderInline(block.children)}</blockquote>;
    case "code": return <pre key={index} className="overflow-x-auto rounded-2xl bg-[#f2f4f6] p-4 text-sm leading-6"><code>{block.text}</code></pre>;
    case "hr": return <hr key={index} className="border-[#e5e8eb]" />;
  }
}

export function MarkdownView({ markdown }: { markdown: string }) {
  return <>{parseMarkdown(markdown).map(renderBlock)}</>;
}
