/**
 * 한 줄을 듣는 동안 인식기가 보낸 결과를 이어 붙여 그 줄 전체의 받아쓴 글을 만든다.
 *
 * 연속 인식(continuous)에서 Android 는 말이 잠깐 멈출 때마다 조각을 확정(isFinal)하고, 그다음 결과는 새 조각만 담는다.
 * iOS 도 쉬고 나면 앞 조각 없이 새로 시작하는 결과가 온다. 마지막 결과로 덮어쓰면 긴 대사의 뒷부분만 남는다
 * (실제 리딩 168줄 중 31줄이 이렇게 잘렸고 그중 20줄은 대사 끝부분만 남았다, SOMA-606).
 *
 * - 확정 조각은 앞 조각 뒤에 붙인다. 앞 조각을 이미 품은 누적 결과(iOS)면 그것으로 바꾼다.
 * - 확정 없이 새로 시작한 중간 결과는 직전 중간 결과를 확정으로 넘긴 뒤 이어 간다.
 */
export type SttTranscript = { committed: string; partial: string };

export const EMPTY_TRANSCRIPT: SttTranscript = { committed: '', partial: '' };

const squash = (s: string) => s.replace(/\s+/g, '');

const join = (a: string, b: string) => (a && b ? `${a} ${b}` : a || b);

/** next 가 prev 를 이어 가는 결과인가 — 앞부분이 같으면 이어 가는 것이다(인식기는 앞 단어를 고쳐 쓰기도 해서 앞 두 글자만 본다). */
function continues(prev: string, next: string): boolean {
  const p = squash(prev);
  const n = squash(next);
  if (!p) return true;
  if (n.length >= p.length) return true;
  const head = Math.min(2, n.length);
  return head > 0 && n.slice(0, head) === p.slice(0, head) && n.length >= p.length / 2;
}

/** committed 를 이미 앞에 품은 결과면 그 뒤만 돌려준다(iOS 는 확정 조각까지 포함해 다시 보내기도 한다). */
function afterCommitted(committed: string, next: string): string | null {
  const c = squash(committed);
  if (!c) return null;
  const n = squash(next);
  if (!n.startsWith(c)) return null;
  // 공백을 무시하고 앞을 맞췄으니 원문에서 같은 글자 수만큼 건너뛴다.
  let seen = 0;
  let i = 0;
  while (i < next.length && seen < c.length) {
    if (!/\s/.test(next[i])) seen += 1;
    i += 1;
  }
  return next.slice(i).trim();
}

export function addResult(state: SttTranscript, transcript: string, isFinal: boolean): SttTranscript {
  const text = transcript.trim();
  if (!text) return isFinal && state.partial ? { committed: join(state.committed, state.partial), partial: '' } : state;
  const rest = afterCommitted(state.committed, text);
  const piece = rest ?? text;
  if (isFinal) return { committed: join(state.committed, piece), partial: '' };
  if (state.partial && !continues(state.partial, piece)) {
    return { committed: join(state.committed, state.partial), partial: piece };
  }
  return { committed: state.committed, partial: piece };
}

export function transcriptText(state: SttTranscript): string {
  return join(state.committed, state.partial);
}
