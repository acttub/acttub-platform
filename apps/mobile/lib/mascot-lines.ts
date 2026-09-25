import { translate as t, translateList } from './i18n.ts';

export type MascotContext = {
  /** 0~23, 기기 시각 */
  hour: number;
  /** 날마다 1씩 느는 수 — 하루 동안은 같은 말을 한다 */
  dayIndex: number;
  /** 연속 연습일 */
  streak: number;
  /** 캐릭터를 누른 횟수 — 누를 때마다 다음 말 */
  taps: number;
};

/** 지금 할 수 있는 말들. 연속 2일부터는 연속일 말이 맨 앞이다. */
export function mascotCandidates(ctx: MascotContext): string[] {
  const lines = [...translateList('home.mascotLines.general')];
  if (ctx.hour >= 5 && ctx.hour < 11) lines.push(...translateList('home.mascotLines.morning'));
  if (ctx.hour >= 21 || ctx.hour < 5) lines.push(...translateList('home.mascotLines.night'));
  if (ctx.streak >= 2) lines.unshift(t('home.mascotLines.streak', { n: ctx.streak }));
  return lines;
}

/**
 * 홈 캐릭터 말풍선 (SOMA-494) — 늘 같은 말이면 캐릭터가 죽어 보인다. 날마다 바뀌고 누르면 다음 말.
 * 문구가 없으면(번역 누락) 예전 한 줄로 돌아간다.
 */
export function mascotLine(ctx: MascotContext): string {
  const lines = mascotCandidates(ctx);
  if (lines.length === 0) return t('home.mascotBubble');
  const i = (((ctx.dayIndex + ctx.taps) % lines.length) + lines.length) % lines.length;
  return lines[i];
}
