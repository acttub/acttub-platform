/**
 * 발음 피드백(실험) — 대본과 다르게 들린 어구를 짚는다. 기기 STT 가 받아쓴 글과 대본을 음절 단위로 맞춰, 어절마다
 * "준비했는지 → '준미했는지'로 들렸어요"를 낸다. 소리를 분석하지 않고 받아쓴 글만 보므로 기기 밖으로 나가는 것이 없다.
 *
 * 받아쓰기는 문맥으로 고쳐 듣는 버릇이 있어 미묘한 발음은 놓친다 — 대신 짚은 곳은 실제로 다르게 들린 곳이다.
 * 어미·조사가 흔들리는 마지막 음절만 다른 어절(했어/했어요, 했는지/했는데)과, 대사를 통째로 다르게 말한 줄
 * (애드리브·다른 줄)은 짚지 않는다.
 */
export type PronunciationNote = {
  /** 대본의 어절(문장부호 뺀 것). */
  word: string;
  /** 그 자리에서 들린 말. 빠졌으면 ''. */
  heard: string;
};

const MAX_NOTES = 3;
/** 대사 전체가 이보다 덜 맞으면 다른 말을 한 것으로 보고 짚지 않는다. */
const MIN_LINE_SIMILARITY = 0.5;

const clean = (s: string) => s.replace(/[^가-힣A-Za-z0-9]/g, '');

type Op = { kind: 'match' | 'sub' | 'del'; heard: string; inserted: string };

/** 대본 음절마다 들린 음절(일치·바뀜·빠짐)과 그 뒤에 끼어든 글자. 편집 거리 역추적. */
function align(script: string[], heard: string[]): Op[] {
  const n = script.length;
  const m = heard.length;
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const cost = script[i - 1] === heard[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j - 1] + cost, d[i - 1][j] + 1, d[i][j - 1] + 1);
    }
  }
  const ops: Op[] = Array.from({ length: n }, () => ({ kind: 'del' as const, heard: '', inserted: '' }));
  let i = n;
  let j = m;
  let trailing = '';
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (script[i - 1] === heard[j - 1] ? 0 : 1)) {
      ops[i - 1] = { kind: script[i - 1] === heard[j - 1] ? 'match' : 'sub', heard: heard[j - 1], inserted: trailing };
      trailing = '';
      i -= 1;
      j -= 1;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops[i - 1] = { kind: 'del', heard: '', inserted: trailing };
      trailing = '';
      i -= 1;
    } else {
      trailing = heard[j - 1] + trailing;
      j -= 1;
    }
  }
  return ops;
}

export function pronunciationNotes(script: string, heardText: string): PronunciationNote[] {
  const words = script.split(/\s+/).map(clean).filter(Boolean);
  const heard = [...clean(heardText)];
  if (words.length === 0 || heard.length === 0) return [];
  const syllables = words.flatMap((w) => [...w]);
  const owner = words.flatMap((w, wi) => [...w].map(() => wi));
  const ops = align(syllables, heard);
  const changed = ops.filter((op) => op.kind !== 'match').length + ops.reduce((n, op) => n + op.inserted.length, 0);
  if (1 - changed / Math.max(syllables.length, heard.length) < MIN_LINE_SIMILARITY) return [];

  const notes: PronunciationNote[] = [];
  words.forEach((word, wi) => {
    const idx = owner.flatMap((o, k) => (o === wi ? [k] : []));
    const wordOps = idx.map((k) => ops[k]);
    // 여러 음절 어절은 마지막 음절(어미·조사)만 다른 것은 보지 않는다.
    const judged = wordOps.length > 1 ? wordOps.slice(0, -1) : wordOps;
    if (!judged.some((op) => op.kind !== 'match')) return;
    const said = wordOps.map((op, k) => op.heard + (k < wordOps.length - 1 ? op.inserted : '')).join('');
    notes.push({ word, heard: said });
  });
  return notes.slice(0, MAX_NOTES);
}
