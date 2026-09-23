/**
 * 연습 기록의 묶음·회차 표시(practice.library·practice.resume). 순수 함수라 화면 없이 테스트한다.
 * 묶음의 제목은 마지막 회차 노트의 제목(없으면 상황 문장, 그것도 없으면 "제목 없는 연습")이고, 즐겨찾기·숨김은
 * 첫 회차(root)의 속성이다. 개별 회차 숨김은 없다.
 */
import type { PracticeGroup, PracticeSummary } from "@/lib/practice/api-types";

export const UNTITLED_PRACTICE = "제목 없는 연습";
/** 날짜를 알 수 없는 묶음이 설 자리. 서버가 회차를 하나도 주지 않은 묶음뿐이라 실제로는 드물다. */
export const UNTITLED_MONTH = "날짜 없음";
/** 기록 목록의 기본 범위. 전부 보기와 최근 30일 사이를 오간다. */
export const RECENT_FILTER_LABEL = "최근 30일";
export const ALL_FILTER_LABEL = "전체";
/** 숨김 문구는 실제 범위를 말한다 — 노트·대화·기억은 지우지 않고 영상은 보관함에 남는다. */
export const HIDE_GROUP_COPY = "기록에서 숨겨요. 영상은 보관함에 남아요";
export const CONTINUE_SAME_VIDEO_LABEL = "같은 영상으로 이어하기";
export const CONTINUE_NEW_VIDEO_LABEL = "새 영상으로 이어하기";

export function lastPractice(group: PracticeGroup): PracticeSummary | null {
  return [...group.practices].sort((a, b) => b.ordinal - a.ordinal)[0] ?? null;
}

export function groupTitle(group: PracticeGroup): string {
  if (group.title?.trim()) return group.title.trim();
  const last = lastPractice(group);
  return last?.note_title?.trim() || last?.situation?.trim() || group.practices.find((p) => p.situation.trim())?.situation.trim() || UNTITLED_PRACTICE;
}

function kstParts(iso: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(iso));
  const pick = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: pick("year"), month: pick("month"), day: pick("day") };
}

/** 월별 묶기의 이름. 회차 시작 날짜(한국 시간) 기준. */
export function monthLabel(iso: string): string {
  const { year, month } = kstParts(iso);
  return `${year}년 ${month}월`;
}

function startedAt(group: PracticeGroup): string {
  return lastPractice(group)?.created_at ?? "";
}

/** 최근 30일 — 마지막 회차 시작 날짜 기준 */
export function recent30(groups: PracticeGroup[], now: Date = new Date()): PracticeGroup[] {
  const floor = now.getTime() - 30 * 86_400_000;
  return groups.filter((g) => new Date(startedAt(g)).getTime() >= floor);
}

export interface RailPractice {
  id: string;
  ordinal: number;
  createdAt: string;
  title: string;
  hasNote: boolean;
  conversationCount: number;
  stage: PracticeSummary["stage"];
}

export interface RailGroup {
  rootId: string;
  title: string;
  favorite: boolean;
  tags: string[];
  inProgressPracticeId: string | null;
  /** 가장 최근 회차 시작 시각 — 목록 순서와 월별 묶기가 쓴다 */
  newestAt: string;
  practices: RailPractice[];
}

function toRailGroup(group: PracticeGroup): RailGroup {
  const practices = [...group.practices]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((p) => ({
      id: p.id,
      ordinal: p.ordinal,
      createdAt: p.created_at,
      title: p.note_title?.trim() || p.situation?.trim() || `${p.ordinal}차 연습`,
      hasNote: Boolean(p.note_id),
      conversationCount: p.conversation_count,
      stage: p.stage,
    }));
  return {
    rootId: group.root_id,
    title: groupTitle(group),
    favorite: group.favorite,
    tags: group.tags,
    inProgressPracticeId: group.in_progress_practice_id ?? null,
    newestAt: startedAt(group),
    practices,
  };
}

/** 왼쪽 목록: 진행 중 묶음(닫히지 않은 회차가 있음)과 지난 묶음. 숨긴 묶음은 빠지고 최근 회차 순이다. */
export function railGroups(groups: PracticeGroup[]): { running: RailGroup[]; finished: RailGroup[] } {
  const visible = groups.filter((g) => !g.hidden_at).map(toRailGroup).sort((a, b) => b.newestAt.localeCompare(a.newestAt));
  return {
    running: visible.filter((g) => g.inProgressPracticeId !== null),
    finished: visible.filter((g) => g.inProgressPracticeId === null),
  };
}

export interface MonthSection {
  /** "2026년 9월" */
  label: string;
  groups: RailGroup[];
}

/**
 * 지난 연습을 월별로 묶는다(practice.library). 기준은 회차 시작 날짜(한국 시간)이고, 묶음은
 * 가장 최근 회차가 속한 달에 놓인다 — 6월에 시작해 9월에 이어한 묶음은 9월에서 찾는다.
 * 들어온 순서(최근 회차 내림차순)를 그대로 따르므로 달도 최근부터 나온다.
 */
export function byMonth(groups: RailGroup[]): MonthSection[] {
  const sections: MonthSection[] = [];
  for (const group of groups) {
    const label = group.newestAt ? monthLabel(group.newestAt) : UNTITLED_MONTH;
    const last = sections[sections.length - 1];
    if (last?.label === label) last.groups.push(group);
    else sections.push({ label, groups: [group] });
  }
  return sections;
}

/** 409 practice_in_progress 뒤 돌아갈 회차. 묶음을 알면 그 묶음의 것, 모르면 아무 진행 중 회차. */
export function inProgressPracticeId(groups: PracticeGroup[], rootId?: string): string | null {
  const pool = rootId ? groups.filter((g) => g.root_id === rootId) : groups;
  return pool.find((g) => g.in_progress_practice_id)?.in_progress_practice_id ?? null;
}

/** 회차 id 로 그 묶음을 찾는다. */
export function groupOfPractice(groups: PracticeGroup[], practiceId: string): PracticeGroup | null {
  return groups.find((g) => g.root_id === practiceId || g.practices.some((p) => p.id === practiceId)) ?? null;
}
