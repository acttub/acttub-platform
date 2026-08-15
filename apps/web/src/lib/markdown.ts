/**
 * 동의 문서(약관·개인정보처리방침)에 쓰는 최소 마크다운 파서.
 *
 * 서버가 마크다운 원문을 body로 내려주는데 웹은 whitespace-pre-wrap 으로 그대로 박고 있어서
 * `#`·`**`·표가 노출됐다(SOMA-391). 파서는 apps/mobile/lib/markdown.ts 에서 이식했고,
 * 실제 문서가 쓰는데 모바일이 못 다루던 두 가지를 더한다 — GFM 표와 중첩 목록.
 * 외부 라이브러리를 들이지 않는 이유는 모바일과 같다: 문서가 쓰는 문법이 좁아서 과하다.
 *
 * 지원: 제목(#~###) · 목록(-, *, 1.) 과 그 중첩 · 인용(>) · 구분선(---) · 표 · 문단,
 *       인라인은 **굵게** · *기울임* · `코드` · [링크](url)
 */

export type MarkdownSpan = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  href?: string;
};

export type MarkdownListItem = {
  spans: MarkdownSpan[];
  /** 이 항목에 딸린 하위 목록. 없으면 빈 배열. */
  children: MarkdownBlock[];
};

export type MarkdownBlock =
  // 제목 깊이는 depth 로 부른다. 모바일 파서는 다른 이름을 쓰지만, web 은 제품 언어 가드가
  // 그 단어를 소스 전체에서 막는다(tests/product-language-guard.test.mjs).
  | { type: 'heading'; depth: 1 | 2 | 3; spans: MarkdownSpan[] }
  | { type: 'paragraph'; spans: MarkdownSpan[] }
  | { type: 'quote'; spans: MarkdownSpan[] }
  | { type: 'list'; ordered: boolean; items: MarkdownListItem[] }
  | { type: 'table'; header: MarkdownSpan[][]; rows: MarkdownSpan[][][] }
  | { type: 'rule' };

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^[-*+]\s+(.*)$/;
const ORDERED = /^\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_ROW = /^\|(.*)\|$/;
/** 표의 두 번째 줄(`| --- | :--: |`). 이 줄이 있어야 앞줄을 헤더로 인정한다. */
const TABLE_DIVIDER = /^\|(?:\s*:?-+:?\s*\|)+$/;

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

/** 선행 공백의 폭. 탭은 4칸으로 세어 목록 깊이를 재는 데만 쓴다. */
function indentWidth(line: string): number {
  const match = /^[ \t]*/.exec(line);
  return match ? match[0].replace(/\t/g, '    ').length : 0;
}

type ListMarker = { ordered: boolean; content: string };

/** 목록 항목이면 마커 종류와 내용을, 아니면 null. 구분선(---)은 목록으로 보지 않는다. */
function listMarker(line: string): ListMarker | null {
  const trimmed = line.trim();
  if (RULE.test(trimmed)) return null;
  const bullet = BULLET.exec(trimmed);
  if (bullet) return { ordered: false, content: bullet[1] };
  const ordered = ORDERED.exec(trimmed);
  if (ordered) return { ordered: true, content: ordered[1] };
  return null;
}

/** `| a | b |` 한 줄을 셀 단위로 쪼갠다. 양끝 파이프는 버린다. */
function parseTableRow(line: string): MarkdownSpan[][] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((cell) => parseInline(cell.trim()));
}

/**
 * 같은 깊이의 목록 항목을 이어서 모은다. 더 깊이 들여쓴 줄은 그 항목의 children 으로 재귀한다.
 * 빈 줄을 만나면 목록을 끝낸다(모바일 파서와 같은 동작 — 문서가 목록 사이를 비우지 않는다).
 */
function collectList(
  lines: string[],
  start: number,
  depth: number,
  ordered: boolean,
): { items: MarkdownListItem[]; next: number } {
  const items: MarkdownListItem[] = [];
  let index = start;

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '') break;

    const width = indentWidth(line);
    if (width < depth) break;

    const marker = listMarker(line);
    // 목록이 아니거나(설명 문단) 종류가 바뀌면(불릿 → 번호) 여기서 끊고 새 블록으로 넘긴다.
    if (!marker || width > depth || marker.ordered !== ordered) break;

    index += 1;
    const children: MarkdownBlock[] = [];
    while (index < lines.length) {
      const childLine = lines[index];
      if (childLine.trim() === '') break;
      const childWidth = indentWidth(childLine);
      if (childWidth <= depth) break;
      const childMarker = listMarker(childLine);
      if (!childMarker) break;
      const nested = collectList(lines, index, childWidth, childMarker.ordered);
      children.push({ type: 'list', ordered: childMarker.ordered, items: nested.items });
      index = nested.next;
    }

    items.push({ spans: parseInline(marker.content.trim()), children });
  }

  return { items, next: index };
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
        depth: heading[1].length as 1 | 2 | 3,
        spans: parseInline(heading[2].trim()),
      });
      index += 1;
      continue;
    }

    // 헤더 줄만으로는 표인지 알 수 없다 — 바로 다음 줄의 구분선까지 봐야 한다.
    if (
      TABLE_ROW.test(trimmed) &&
      index + 1 < lines.length &&
      TABLE_DIVIDER.test(lines[index + 1].trim())
    ) {
      flushParagraph();
      const header = parseTableRow(trimmed);
      index += 2;
      const rows: MarkdownSpan[][][] = [];
      while (index < lines.length) {
        const rowLine = lines[index].trim();
        if (!TABLE_ROW.test(rowLine) || TABLE_DIVIDER.test(rowLine)) break;
        rows.push(parseTableRow(rowLine));
        index += 1;
      }
      blocks.push({ type: 'table', header, rows });
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

    const marker = listMarker(line);
    if (marker) {
      flushParagraph();
      const collected = collectList(lines, index, indentWidth(line), marker.ordered);
      blocks.push({ type: 'list', ordered: marker.ordered, items: collected.items });
      index = collected.next;
      continue;
    }

    paragraph.push(trimmed);
    index += 1;
  }

  flushParagraph();
  return blocks;
}
