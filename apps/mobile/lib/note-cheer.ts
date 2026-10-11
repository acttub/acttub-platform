/**
 * 연습 노트 끝의 마스코트 응원 한마디(SOMA-662). 노트를 열 때마다 다섯 개 중 하나를 무작위로 고른다.
 * 문구는 locales 의 noteCheer 에 있다.
 */
export const NOTE_CHEER_KEYS = [
  'noteCheer.one',
  'noteCheer.two',
  'noteCheer.three',
  'noteCheer.four',
  'noteCheer.five',
] as const;

export type NoteCheerKey = (typeof NOTE_CHEER_KEYS)[number];

export function pickNoteCheer(random: () => number = Math.random): NoteCheerKey {
  const index = Math.min(NOTE_CHEER_KEYS.length - 1, Math.floor(random() * NOTE_CHEER_KEYS.length));
  return NOTE_CHEER_KEYS[index];
}
