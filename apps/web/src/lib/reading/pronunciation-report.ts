/**
 * 리딩 발음 보고서(SOMA-606, 실험) — 서버 `GET /v2/reading/sessions/{id}/pronunciation` 의 응답 모양과 화면 계산.
 *
 * 앱의 같은 이름 파일(apps/mobile/lib/reading/pronunciation-report.ts)을 옮겼다. 보고서 화면을 웹으로 두고 앱은 이 페이지를
 * 띄우기만 해서, 출시 뒤에도 앱 빌드 없이 화면을 고칠 수 있게 한다.
 *
 * 서버 스위치(PRON_REPORT_ENABLED)와 허용 사람 목록 밖이면 404 `pronunciation_not_available` 이다.
 * 끝난 리딩을 처음 물으면 서버가 분석을 줄 세우고(queued → running), 끝나면 done(또는 쓸 줄이 없으면 skipped).
 * 보고서 칸은 서버 기록(자바 레코드) 그대로 camelCase 다. lineNo 는 대본 줄 ordinal 이다.
 *
 * 색 규칙(10/22 사용자 승인): 이번 리딩에서 확실히 짚힌 어절만 주황, 한 줄에 최대 2개. 모범 음성은 넣지 않는다.
 */
export type PronunciationStatus = "queued" | "running" | "done" | "skipped" | "failed";
export type PronunciationMark = { index: number; word: string; lpr: number; startMs: number | null; endMs: number | null };
export type PronunciationLine = { lineNo: number; text: string; marks: PronunciationMark[] };
export type PronunciationHabit = {
  habit: "ONSET" | "CODA" | "VOWEL";
  label: string;
  count: number;
  examples: { lineNo: number; word: string; expected: string; heard: string; lpr: number }[];
};
export type PronunciationReport = {
  summary: { sounds: number; clearSounds: number; clearRatio: number; linesUsed: number; linesSkipped: number };
  misheard: { lineNo: number; word: string; heard: string }[];
  habit: PronunciationHabit | null;
  skippedLines: number[];
  /** 줄별 색 표시. 10/22 이전 보고서에는 없다. */
  lines?: PronunciationLine[];
};
export type PronunciationState = { status: PronunciationStatus; report: PronunciationReport | null };

/** 서버가 이 사람에게 보고서를 열지 않았을 때의 오류 코드. 실패가 아니라 준비 중이다. */
export const PRONUNCIATION_NOT_AVAILABLE = "pronunciation_not_available";

/** 더 기다릴 필요가 없는 상태. */
export function pronunciationSettled(status: PronunciationStatus): boolean {
  return status === "done" || status === "skipped" || status === "failed";
}

/** 서버 clean() 과 같게 — 한글·영문·숫자만 남긴다. */
function clean(word: string): string {
  return word.replace(/[^가-힣A-Za-z0-9]/g, "");
}

export type MarkSegment = { text: string; marked: boolean };

/**
 * 줄 글을 칠할 어절과 아닌 부분으로 나눈다. 서버 어절 순서(index)와 띄어쓰기 순서가 같으면 그 자리를, 다르면 같은 글자의
 * 첫 어절을 칠한다. 띄어쓰기는 그대로 둔다.
 */
export function markSegments(text: string, marks: readonly PronunciationMark[]): MarkSegment[] {
  const tokens = text.split(/(\s+)/);
  const words = tokens.map((tok, i) => ({ tok, i })).filter(({ tok }) => tok.trim() !== "");
  const hit = new Set<number>();
  for (const mark of marks) {
    const want = clean(mark.word);
    if (!want) continue;
    const byIndex = words[mark.index];
    if (byIndex && clean(byIndex.tok) === want && !hit.has(byIndex.i)) {
      hit.add(byIndex.i);
      continue;
    }
    const found = words.find(({ tok, i }) => !hit.has(i) && clean(tok) === want);
    if (found) hit.add(found.i);
  }
  const out: MarkSegment[] = [];
  tokens.forEach((tok, i) => {
    if (tok === "") return;
    const marked = hit.has(i);
    const last = out[out.length - 1];
    if (last && last.marked === marked) last.text += tok;
    else out.push({ text: tok, marked });
  });
  return out;
}

/** 칠한 어절이 있는 줄 수. 보고서 첫 줄 요약에 쓴다. */
export function markedLineCount(report: PronunciationReport): number {
  return (report.lines ?? []).filter((l) => l.marks.length > 0).length;
}

/** 보고서 줄 번호(대본 줄 ordinal)로 줄 id 를 찾는다. 글이 다르면 같은 글의 줄을 찾는다. */
export function lineIdOf(
  scriptLines: readonly { id: string; ordinal: number; text: string }[],
  line: Pick<PronunciationLine, "lineNo" | "text">,
): string | null {
  const byOrdinal = scriptLines.find((l) => l.ordinal === line.lineNo);
  if (byOrdinal && byOrdinal.text === line.text) return byOrdinal.id;
  return scriptLines.find((l) => l.text === line.text)?.id ?? byOrdinal?.id ?? null;
}

/** 줄마다 가장 마지막 시도(attempt_no 가 가장 큰) 녹음. */
export function latestByLine<T extends { line_id: string; attempt_no: number }>(recordings: readonly T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const rec of recordings) {
    const prev = out.get(rec.line_id);
    if (!prev || rec.attempt_no > prev.attempt_no) out.set(rec.line_id, rec);
  }
  return out;
}

/** 어절만 들을 때 앞뒤로 더 트는 여유(10/22 시안 — 150ms). */
export const PAD_MS = 150;

/** 어절 구간 재생 범위(초). 시간 정보가 없으면 null — 줄 전체를 튼다. */
export function markWindow(mark: Pick<PronunciationMark, "startMs" | "endMs">): { from: number; to: number } | null {
  if (mark.startMs == null || mark.endMs == null) return null;
  return { from: Math.max(0, mark.startMs - PAD_MS) / 1000, to: (mark.endMs + PAD_MS) / 1000 };
}
