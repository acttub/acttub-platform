/**
 * 리포트 본문·동의 문서에 쓰는 최소 마크다운 파서.
 *
 * 서버가 마크다운 원문을 내려주는데 앱은 <Text>에 그대로 박고 있어서 `#`·`**`가 노출됐다.
 * 외부 라이브러리(react-native-markdown-display 등)는 이 앱이 쓰는 문법에 비해 과하고
 * 네이티브 의존성·스타일 오버라이드가 붙어서, 필요한 문법만 파싱하는 순수 함수로 둔다.
 *
 * 지원: 제목(#~###) · 순서 없는 목록(-, *) · 순서 있는 목록(1.) · 인용(>) · 구분선(---)
 *       · 문단, 인라인은 **굵게** · *기울임* · `코드` · [링크](url)
 */

export type MarkdownSpan = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  href?: string;
};

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; spans: MarkdownSpan[] }
  | { type: 'paragraph'; spans: MarkdownSpan[] }
  | { type: 'quote'; spans: MarkdownSpan[] }
  | { type: 'list'; ordered: boolean; items: MarkdownSpan[][] }
  | { type: 'rule' };

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^[-*+]\s+(.*)$/;
const ORDERED = /^\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

/** 인라인 마크업을 스팬 배열로 쪼갠다. 중첩(**_굵고 기울임_**)은 지원하지 않는다. */
export function parseInline(text: string): MarkdownSpan[] {
  const spans: MarkdownSpan[] = [];
  const pattern = /(\*\*|__)(.+?)\1|(\*|_)(?!\s)(.+?)\3|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;

  const push = (span: MarkdownSpan) => {
    if (!span.text) return;
    spans.push(span);
  };

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) push({ text: text.slice(last, match.index) });
    if (match[2] !== undefined) push({ text: match[2], bold: true });
    else if (match[4] !== undefined) push({ text: match[4], italic: true });
    else if (match[5] !== undefined) push({ text: match[5], code: true });
    else if (match[6] !== undefined) push({ text: match[6], href: match[7] });
    last = match.index + match[0].length;
  }
  if (last < text.length) push({ text: text.slice(last) });
  return spans.length > 0 ? spans : [{ text }];
}

/** 마크다운 원문을 블록 배열로 만든다. 빈 입력이면 빈 배열. */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = (source ?? '').replace(/\r\n?/g, '\n').split('\n');

  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: 'paragraph', spans: parseInline(paragraph.join(' ').trim()) });
    paragraph = [];
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed === '') {
      flushParagraph();
      index += 1;
      continue;
    }

    if (RULE.test(trimmed)) {
      flushParagraph();
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        spans: parseInline(heading[2].trim()),
      });
      index += 1;
      continue;
    }

    const quote = QUOTE.exec(trimmed);
    if (quote) {
      flushParagraph();
      const quoted: string[] = [quote[1]];
      index += 1;
      while (index < lines.length) {
        const next = QUOTE.exec(lines[index].trim());
        if (!next) break;
        quoted.push(next[1]);
        index += 1;
      }
      blocks.push({ type: 'quote', spans: parseInline(quoted.join(' ').trim()) });
      continue;
    }

    const bullet = BULLET.exec(trimmed);
    const ordered = ORDERED.exec(trimmed);
    if (bullet || ordered) {
      flushParagraph();
      const isOrdered = !bullet;
      const items: MarkdownSpan[][] = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        const matched = isOrdered ? ORDERED.exec(current) : BULLET.exec(current);
        if (!matched) break;
        items.push(parseInline(matched[1].trim()));
        index += 1;
      }
      blocks.push({ type: 'list', ordered: isOrdered, items });
      continue;
    }

    paragraph.push(trimmed);
    index += 1;
  }

  flushParagraph();
  return blocks;
}
