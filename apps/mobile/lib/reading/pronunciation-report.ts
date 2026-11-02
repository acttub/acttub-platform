/**
 * 리딩 발음 보고서(SOMA-606, 실험) — 서버 `GET /v2/reading/sessions/{id}/pronunciation` 의 응답 모양과 화면 계산.
 *
 * 서버 스위치(PRON_REPORT_ENABLED)와 허용 사람 목록 밖이면 404 `pronunciation_not_available` 이라 앱은 줄을 숨긴다.
 * 끝난 리딩을 처음 물으면 서버가 채점을 줄 세우고(queued → running), 끝나면 done(또는 쓸 줄이 없으면 skipped).
 * 보고서 칸은 서버 기록(자바 레코드) 그대로 camelCase 다.
 *
 * 색 규칙(10/22 사용자 승인): 이번 리딩에서 확실히 짚힌 어절만 주황, 한 줄에 최대 2개. 모범 음성은 넣지 않는다.
 * 지난 리딩과 겹치는 어절의 빨강(「또 걸렸어요」)은 서버가 지난 보고서를 아직 견주지 않아 그리지 않는다.
 */
export type PronunciationStatus = 'queued' | 'running' | 'done' | 'skipped' | 'failed';

/** 칠한 어절의 상세 분석(11/1) — 어떻게 들렸나 · 어디가 · 두 소리 차이 · 해 볼 연습. 옛 보고서·설명할 수 없는 소리면 없다. */
export type PronunciationDetail = { heard: string; where: string; kind: string; diff: string; practice: string };
export type PronunciationMark = {
  index: number;
  word: string;
  lpr: number;
  startMs: number | null;
  endMs: number | null;
  detail?: PronunciationDetail | null;
};
/** sounds·clearSounds: 이 줄에서 센 소리와 그중 또렷한 소리(11/2 추가 — 이전 보고서엔 없다). */
export type PronunciationLine = { lineNo: number; text: string; marks: PronunciationMark[]; sounds?: number; clearSounds?: number };
export type PronunciationHabit = {
  habit: 'ONSET' | 'CODA' | 'VOWEL';
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

/** 더 기다릴 필요가 없는 상태. */
export function pronunciationSettled(status: PronunciationStatus): boolean {
  return status === 'done' || status === 'skipped' || status === 'failed';
}

/** 서버 clean() 과 같게 — 한글·영문·숫자만 남긴다. */
function clean(word: string): string {
  return word.replace(/[^가-힣A-Za-z0-9]/g, '');
}

export type MarkSegment = { text: string; marked: boolean };

/**
 * 줄 글을 칠할 어절과 아닌 부분으로 나눈다. 서버 어절 순서(index)와 띄어쓰기 순서가 같으면 그 자리를, 다르면 같은 글자의
 * 첫 어절을 칠한다. 띄어쓰기는 그대로 둔다.
 */
export function markSegments(text: string, marks: readonly PronunciationMark[]): MarkSegment[] {
  const tokens = text.split(/(\s+)/);
  const words = tokens.map((tok, i) => ({ tok, i })).filter(({ tok }) => tok.trim() !== '');
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
    if (tok === '') return;
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

/** 상세 분석이 있는 칠한 어절. 「상세 보고서」 칸에 그린다. */
/** 줄 점수(또렷한 소리 수/센 소리 수). 이전 보고서이거나 센 소리가 없으면 null. */
export function lineScore(line: PronunciationLine): { clear: number; total: number; percent: number } | null {
  const total = line.sounds ?? 0;
  if (total <= 0 || line.clearSounds == null) return null;
  const clear = Math.min(Math.max(line.clearSounds, 0), total);
  return { clear, total, percent: Math.round((clear * 100) / total) };
}

/** 어절 점수 — 모델의 lpr 원래 값(음수, 10/20 사용자 선택)을 소수 한 자리로. 마이너스는 '−'로 적는다. */
export function markScore(lpr: number): string {
  const v = Math.round(lpr * 10) / 10;
  return v < 0 ? `−${Math.abs(v).toFixed(1)}` : v.toFixed(1);
}

export function detailedMarks(line: PronunciationLine): (PronunciationMark & { detail: PronunciationDetail })[] {
  return line.marks.filter((m): m is PronunciationMark & { detail: PronunciationDetail } => !!m.detail);
}

/**
 * 「다른 말로 알아들을 수 있는 곳」에 남길 줄. 서버는 1.1.0 앱을 위해 상세 분석을 이 목록에도 문장으로 넣는다 —
 * 줄 밑 「상세 보고서」로 이미 보이는 같은 줄·같은 어절은 뺀다.
 */
export function misheardRows(report: PronunciationReport): PronunciationReport['misheard'] {
  const shown = new Set<string>();
  for (const line of report.lines ?? []) for (const m of detailedMarks(line)) shown.add(`${line.lineNo}:${clean(m.word)}`);
  return report.misheard.filter((r) => !shown.has(`${r.lineNo}:${clean(r.word)}`));
}
