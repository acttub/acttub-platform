/**
 * 지문 멈춤(SOMA-937) — 순수 함수. 화면·오디오를 모른다.
 *
 * 리딩은 지문·장면을 진행에서 건너뛰어, 지문이 지나간 뒤에야 위쪽 기록에 흐리게 쌓였다(2026-10-28 Play 리뷰 「지문은 보여주지 않고
 * 대사만 연결」). 그래서 다음 대사로 넘어가기 직전, 그 대사 바로 앞의 지문·장면 줄을 지금 줄 자리에 띄우고 잠깐 멈춘다. 멈춘 동안은
 * 상대 읽기·마이크를 열지 않고, [다음]을 누르면 바로 대사로 간다. 진행 위치·진행 수(K / N)는 그대로 대사 줄 기준이다.
 *
 * 첫 대사 앞의 지문(무대·인물 소개)은 구간이 첫 대사로 당겨져(snapRangeToDialogues) 구간 밖이지만, 첫 대사 바로 앞이라 같은
 * 규칙으로 시작할 때 보인다.
 */
import type { ScriptLine } from './types.ts';

/** 한 번에 띄우는 지문 줄 수 — 가까운 줄부터. */
export const BEAT_MAX_LINES = 6;
export const BEAT_MIN_MS = 1500;
export const BEAT_MAX_MS = 6000;
/** 글자당 머무는 시간. 한국어를 눈으로 읽는 속도(초당 20자 남짓)보다 조금 넉넉하다. */
export const BEAT_MS_PER_CHAR = 45;

/**
 * index 줄 바로 앞의 지문·장면 줄 인덱스(원래 순서). 대사를 만나면 멈추고, 장면 머리는 넣고 멈춘다(앞 장면 지문까지 끌어오지 않는다).
 */
export function directionsBefore(lines: ScriptLine[], index: number): number[] {
  const out: number[] = [];
  for (let i = index - 1; i >= 0 && out.length < BEAT_MAX_LINES; i--) {
    const line = lines[i];
    if (!line || line.type === 'dialogue') break;
    out.unshift(i);
    if (line.type === 'scene') break;
  }
  return out;
}

/** 지문을 띄워 둘 시간. 짧은 「침묵」도 알아볼 만큼, 긴 무대 설명도 너무 오래 붙잡지 않게. */
export function beatMs(texts: string[]): number {
  const chars = texts.reduce((n, text) => n + [...text.trim()].length, 0);
  return Math.min(BEAT_MAX_MS, Math.max(BEAT_MIN_MS, 800 + chars * BEAT_MS_PER_CHAR));
}
