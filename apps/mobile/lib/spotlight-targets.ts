/**
 * 가이드가 비출 자리를 어디서든 알 수 있게 모아 둔다 (SOMA-550).
 *
 * <p>비출 대상이 한 화면 안에만 있지 않다. 홈 화면은 자기 카드를 알지만, 아래 촬영 버튼은
 * 탭바(다른 화면)가 그린다. 그 자리를 홈까지 넘기려면 화면 밖으로 값을 들고 다녀야 한다.
 *
 * <p>그래서 이름표 하나로 자리만 주고받는다. 그리는 쪽이 자기 자리를 재서 여기 적고,
 * 가이드는 이름표로 꺼내 쓴다. 서로를 몰라도 되고, 아직 안 그려졌으면 없을 뿐이다.
 */

export type TargetRect = { x: number; y: number; width: number; height: number };

const rects = new Map<string, TargetRect>();
const listeners = new Set<() => void>();
const measurers = new Map<string, () => void>();

/** 다 그려진 뒤 자기 자리를 적는다. 같은 자리면 알리지 않는다 — 다시 그릴 일이 없다. */
export function setTargetRect(id: string, rect: TargetRect): void {
  const old = rects.get(id);
  if (
    old &&
    old.x === rect.x &&
    old.y === rect.y &&
    old.width === rect.width &&
    old.height === rect.height
  ) {
    return;
  }
  rects.set(id, rect);
  listeners.forEach((fn) => fn());
}

/** 아직 안 그려졌으면 null — 가이드는 그 단계에서 화면 전체를 덮고 설명만 보여 준다. */
export function targetRect(id: string): TargetRect | null {
  return rects.get(id) ?? null;
}

export function clearTargetRect(id: string): void {
  if (!rects.delete(id)) return;
  listeners.forEach((fn) => fn());
}

/**
 * 자기 자리를 다시 재는 법을 맡겨 둔다. 끊는 함수를 돌려준다.
 *
 * <p>맨 처음 재는 값은 믿을 수 없다 — 목록 안의 요소는 첫 배치 때 아직 제자리가 아니라
 * 화면 맨 위(0)로 잡히는 일이 있다. 그래서 가이드를 띄우는 순간 한 번 더 재게 한다.
 */
export function registerMeasure(id: string, measure: () => void): () => void {
  measurers.set(id, measure);
  return () => {
    if (measurers.get(id) === measure) measurers.delete(id);
  };
}

/** 지금 화면에 있는 자리들을 모두 다시 잰다. 가이드가 열릴 때 부른다. */
export function remeasureTargets(): void {
  measurers.forEach((measure) => measure());
}

/** 자리가 바뀌면 알려 준다(화면 회전·탭 전환). 끊는 함수를 돌려준다. */
export function onTargetsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 가이드가 비출 자리들의 이름표. 적는 쪽과 꺼내는 쪽이 어긋나지 않게 한곳에 둔다. */
export const TARGET = {
  /** 홈의 "지금 바로 연습하기" 배너. */
  homeStart: 'home.start',
  /** 탭바 가운데 촬영 버튼. */
  shoot: 'tabs.shoot',
  /** 대본 탭의 "새 대본" 버튼. */
  readingNew: 'reading.new',
} as const;
