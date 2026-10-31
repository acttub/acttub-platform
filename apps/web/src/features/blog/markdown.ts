// 블로그 본문용 최소 마크다운 파서. HTML 을 해석하지 않는다 — 원문 `<script>` 같은 것은 글자 그대로
// 텍스트 노드가 되고, 렌더러(markdown-view.tsx)는 dangerouslySetInnerHTML 을 쓰지 않는다.
// 링크·이미지 주소는 http(s)·mailto·상대 경로만 통과한다(javascript: 등은 글자로만 남긴다).

export type Inline =
  | { t: "text"; text: string }
  | { t: "strong"; children: Inline[] }
  | { t: "em"; children: Inline[] }
  | { t: "code"; text: string }
  | { t: "link"; href: string; children: Inline[] }
  | { t: "image"; src: string; alt: string };

export type MdBlock =
  | { t: "heading"; depth: 2 | 3; children: Inline[] }
  | { t: "p"; children: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; items: Inline[][] }
  | { t: "quote"; children: Inline[] }
  | { t: "code"; text: string }
  | { t: "hr" };

export function safeUrl(raw: string): string | null {
  const url = raw.trim();
  if (url === "" || /[\u0000-\u001f\s]/.test(url)) return null;
  if (url.startsWith("//")) return null;
  if (url.startsWith("/") || url.startsWith("#")) return url;
  return /^(https?:\/\/|mailto:)/i.test(url) ? url : null;
}

const INLINE_PATTERN =
  /(`[^`\n]+`)|(!\[([^\]\n]*)\]\(([^)\s]+)\))|(\[([^\]\n]+)\]\(([^)\s]+)\))|(\*\*([^*\n]+)\*\*)|(\*([^*\n]+)\*)/g;

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const pushText = (text: string) => {
    if (text) out.push({ t: "text", text });
  };
  for (const m of source.matchAll(INLINE_PATTERN)) {
    const index = m.index ?? 0;
    pushText(source.slice(last, index));
    last = index + m[0].length;
    if (m[1]) {
      out.push({ t: "code", text: m[1].slice(1, -1) });
    } else if (m[2]) {
      const src = safeUrl(m[4]);
      if (src) out.push({ t: "image", src, alt: m[3] });
      else pushText(m[0]);
    } else if (m[5]) {
      const href = safeUrl(m[7]);
      if (href) out.push({ t: "link", href, children: parseInline(m[6]) });
      else pushText(m[0]);
    } else if (m[8]) {
      out.push({ t: "strong", children: parseInline(m[9]) });
    } else if (m[10]) {
      out.push({ t: "em", children: parseInline(m[11]) });
    }
  }
  pushText(source.slice(last));
  return out;
}

export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;
  const startsBlock = (line: string) =>
    /^(#{1,6})\s/.test(line) || /^\s*([-*])\s+/.test(line) || /^\s*\d+\.\s+/.test(line) ||
    /^>\s?/.test(line) || /^```/.test(line) || /^(-{3,}|\*{3,})\s*$/.test(line);

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i += 1; continue; }

    if (/^```/.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i += 1;
      blocks.push({ t: "code", text: body.join("\n") });
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { blocks.push({ t: "hr" }); i += 1; continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      // 페이지의 h1 은 글 제목이 쓴다. 본문의 #, ## 은 h2, 그 아래는 h3 로 맞춘다.
      const depth = heading[1].length <= 2 ? 2 : 3;
      blocks.push({ t: "heading", depth, children: parseInline(heading[2].trim()) });
      i += 1;
      continue;
    }

    if (/^\s*([-*])\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const pattern = ordered ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-*]\s+(.*)$/;
      const items: Inline[][] = [];
      while (i < lines.length) {
        const item = pattern.exec(lines[i]);
        if (!item) break;
        items.push(parseInline(item[1]));
        i += 1;
      }
      blocks.push(ordered ? { t: "ol", items } : { t: "ul", items });
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ t: "quote", children: parseInline(quote.join(" ")) });
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && (para.length === 0 || !startsBlock(lines[i]))) {
      para.push(lines[i++].trim());
    }
    blocks.push({ t: "p", children: parseInline(para.join(" ")) });
  }
  return blocks;
}
