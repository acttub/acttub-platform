/**
 * PDF → 텍스트. 브라우저 안에서 pdf.js로 뽑는다(서버로 안 간다).
 *
 * 파일에 담긴 순서대로 이어 붙이면 안 된다. 한글 프로그램에서 만든 PDF 는
 * 괄호·숫자를 본문과 다른 순서로 저장해 두는 일이 잦아서 문장이 뒤섞인다.
 * 그래서 화면에 놓인 자리를 기준으로 줄을 다시 세운다.
 *
 * 굵은 글씨를 여러 번 겹쳐 그리는 것도 흔하다. 그대로 두면 같은 말이 두 번,
 * 네 번 반복되므로 걷어낸다.
 */

interface Piece {
  s: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 굵게 보이려고 같은 문장을 나란히 다시 그린 줄. 통째로 겹치면 한 번만 남긴다. */
export function collapseRepeat(line: string): string {
  let out = line;
  for (let i = 0; i < 3; i++) {
    const n = out.length;
    if (n < 8 || n % 2 !== 0) break;
    const half = n / 2;
    if (out.slice(0, half) !== out.slice(half)) break;
    out = out.slice(0, half);
  }
  return out;
}

/** 겹쳐 그린 같은 글자인지 — 굵어 보이려면 겹쳐야 하므로 겹친 넓이로 가린다. */
function isOverdrawn(kept: Piece[], it: Piece): boolean {
  return kept.some((k) => {
    if (k.s !== it.s) return false;
    const overlap = Math.min(k.x + k.w, it.x + it.w) - Math.max(k.x, it.x);
    return overlap > Math.min(k.w, it.w) * 0.5;
  });
}

export function piecesToLines(items: Piece[]): string[] {
  if (!items.length) return [];

  // 글자 높이의 절반 안에 있으면 같은 줄로 본다.
  const tol = Math.max(2, (items.reduce((a, b) => a + b.h, 0) / items.length) * 0.5);
  const rows: { y: number; items: Piece[] }[] = [];
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= tol);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }

  const lines: string[] = [];
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    const kept: Piece[] = [];
    let text = "";
    let prev: Piece | null = null;
    for (const it of row.items) {
      if (isOverdrawn(kept, it)) continue;
      // 사이가 눈에 띄게 벌어졌으면 띄어쓰기로 본다.
      if (prev && it.x - (prev.x + prev.w) > prev.h * 0.25) text += " ";
      text += it.s;
      kept.push(it);
      prev = it;
    }
    const cleaned = collapseRepeat(text.replace(/\s+/g, " ").trim());
    if (cleaned) lines.push(cleaned);
  }
  return lines;
}

export async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;

  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: Piece[] = [];
    for (const it of content.items) {
      if (!("str" in it) || !it.str) continue;
      const t = it.transform;
      items.push({ s: it.str, x: t[4], y: t[5], w: it.width ?? 0, h: Math.abs(t[3]) || 10 });
    }
    const lines = piecesToLines(items);
    if (lines.length) pages.push(lines.join("\n"));
  }
  return pages.join("\n\n");
}
