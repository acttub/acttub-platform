import { parseMarkdown, type MarkdownBlock, type MarkdownSpan } from "@/lib/markdown";

/**
 * 동의 문서 본문을 그린다(파싱은 lib/markdown).
 *
 * 서버가 내려주는 마크다운 원문을 렌더하되 raw HTML 은 다루지 않는다 — 파서가 텍스트 스팬만
 * 내놓으므로 dangerouslySetInnerHTML 이 필요 없고, 그래서 XSS 표면이 생기지 않는다.
 */
export function ConsentMarkdown({ source }: { source: string }) {
  return <>{renderBlocks(parseMarkdown(source))}</>;
}

function renderBlocks(blocks: MarkdownBlock[]) {
  return blocks.map((block, index) => (
    <Block key={index} block={block} spacing={spacingFor(block, index)} />
  ));
}

/** 첫 블록은 위 여백 없이 붙이고, 제목 앞은 문단보다 넉넉하게 띄운다. */
function spacingFor(block: MarkdownBlock, index: number): string {
  if (index === 0) return "";
  return block.type === "heading" ? "mt-5" : "mt-3";
}

function Block({ block, spacing }: { block: MarkdownBlock; spacing: string }) {
  switch (block.type) {
    case "heading": {
      // 카드 안에 이미 h2(문서 제목)가 있어서 본문 제목은 h3 부터 시작한다.
      const className = `${spacing} ${headingStyles[block.depth - 1]}`;
      const spans = <Spans spans={block.spans} />;
      if (block.depth === 1) return <h3 className={className}>{spans}</h3>;
      if (block.depth === 2) return <h4 className={className}>{spans}</h4>;
      return <h5 className={className}>{spans}</h5>;
    }
    case "paragraph":
      return (
        <p className={`${spacing} text-sm leading-6 text-[#4e5968]`}>
          <Spans spans={block.spans} />
        </p>
      );
    case "quote":
      return (
        <blockquote
          className={`${spacing} border-l-2 border-[#d1d6db] pl-3 text-sm leading-6 text-[#8b95a1]`}
        >
          <Spans spans={block.spans} />
        </blockquote>
      );
    case "rule":
      return <hr className={`${spacing} border-t border-[#e5e8eb]`} />;
    case "list":
      return <List block={block} spacing={spacing} />;
    case "table":
      return <Table block={block} spacing={spacing} />;
  }
}

function List({
  block,
  spacing,
}: {
  block: Extract<MarkdownBlock, { type: "list" }>;
  spacing: string;
}) {
  const className = `${spacing} space-y-1 pl-5 text-sm leading-6 text-[#4e5968] ${
    block.ordered ? "list-decimal" : "list-disc"
  }`;
  const items = block.items.map((item, index) => (
    <li key={index} className="pl-1 marker:text-[#8b95a1]">
      <Spans spans={item.spans} />
      {item.children.length > 0 ? renderBlocks(item.children) : null}
    </li>
  ));

  return block.ordered ? (
    <ol className={className}>{items}</ol>
  ) : (
    <ul className={className}>{items}</ul>
  );
}

/**
 * 개인정보처리방침의 수탁자 표처럼 열이 넓은 표가 있어서, 본문 스크롤 박스를 밀지 않도록
 * 표만 따로 가로 스크롤을 갖는다.
 */
function Table({
  block,
  spacing,
}: {
  block: Extract<MarkdownBlock, { type: "table" }>;
  spacing: string;
}) {
  return (
    <div className={`${spacing} overflow-x-auto rounded-xl border border-[#e5e8eb]`}>
      <table className="w-full border-collapse text-[13px] leading-5">
        <thead>
          <tr>
            {block.header.map((cell, index) => (
              <th
                key={index}
                className="border-b border-[#e5e8eb] bg-[#f2f4f6] px-3 py-2 text-left font-semibold text-[#333d4b]"
              >
                <Spans spans={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-[#f2f4f6] last:border-b-0">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2 align-top text-[#4e5968]">
                  <Spans spans={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Spans({ spans }: { spans: MarkdownSpan[] }) {
  return (
    <>
      {spans.map((span, index) => {
        if (span.href) {
          return (
            <a
              key={index}
              href={span.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#3182f6] underline underline-offset-2"
            >
              {span.text}
            </a>
          );
        }
        if (span.bold) {
          return (
            <strong key={index} className="font-semibold text-[#333d4b]">
              {span.text}
            </strong>
          );
        }
        if (span.italic) return <em key={index}>{span.text}</em>;
        if (span.code) {
          return (
            <code key={index} className="rounded bg-[#f2f4f6] px-1 py-0.5 text-[13px]">
              {span.text}
            </code>
          );
        }
        return <span key={index}>{span.text}</span>;
      })}
    </>
  );
}

const headingStyles = [
  "text-base font-bold tracking-[-0.02em] text-[#191f28]",
  "text-sm font-bold text-[#191f28]",
  "text-[13px] font-semibold text-[#333d4b]",
];
