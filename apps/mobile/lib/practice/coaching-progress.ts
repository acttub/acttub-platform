import { translate } from '../i18n.ts';
import type { PracticeGroup } from './types.ts';

/** 서버가 권하는 횟수를 주지 않을 때 쓰는 장면마다의 연습 횟수(스펙 practice/library, SOMA-810). */
export const DEFAULT_PRACTICE_GOAL = 3;

export type PracticeProgress = { count: number; goal: number; filled: number; label: string };

/**
 * 코칭 탭 장면 카드의 「n/3번 해 봤어요」와 진행 점(SOMA-810). 서버 스위치가 꺼져 `practice_count`가 없거나 옛 자료라 null이면
 * null — 화면은 글과 점을 둘 다 숨긴다. 목표를 넘으면 점은 다 채우고 글은 「n번 해 봤어요」다.
 */
export function practiceProgress(group: Pick<PracticeGroup, 'practice_count' | 'practice_goal'>): PracticeProgress | null {
  const count = group.practice_count;
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return null;
  const goal = typeof group.practice_goal === 'number' && group.practice_goal > 0 ? group.practice_goal : DEFAULT_PRACTICE_GOAL;
  const over = count > goal;
  return {
    count,
    goal,
    filled: Math.min(count, goal),
    label: over ? translate('coachingTab.progressOver', { n: count }) : translate('coachingTab.progress', { n: count, goal }),
  };
}

/** 영상 길이 밀리초 → 「m:ss」. 없거나(null·undefined) 0 이하·숫자가 아니면 null — 그 칸을 숨긴다. */
export function formatVideoDuration(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  const total = Math.max(1, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 최근 코칭 줄의 영상 길이 — 그 묶음의 마지막 회차 영상 길이(m:ss). 값이 없으면 null. */
export function groupVideoDuration(group: Pick<PracticeGroup, 'practices'>): string | null {
  const last = [...(group.practices ?? [])].sort((a, b) => a.ordinal - b.ordinal).at(-1);
  return formatVideoDuration(last?.video_duration_ms);
}

/** 서버 태그 값 → 화면 문구 키. 표에 없는 값은 보이지 않는다(사람이 읽는 말이 정해지지 않았다). */
const TAG_LABEL_KEYS: Record<string, string> = {
  emotion_memory: 'coachingTab.tag.emotionMemory',
  resolved: 'coachingTab.tag.resolved',
};

/** 최근 코칭 줄의 태그 칩 문구. 아는 값만, 같은 값은 한 번만. 없으면 빈 배열 — 칩 줄을 숨긴다. */
export function groupTagLabels(group: Pick<PracticeGroup, 'tags'>): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const tag of group.tags ?? []) {
    const key = TAG_LABEL_KEYS[tag];
    if (!key || seen.has(tag)) continue;
    seen.add(tag);
    labels.push(translate(key));
  }
  return labels;
}
