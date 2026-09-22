/**
 * 스포트라이트 가이드 — 눌러야 할 곳만 남기고 나머지를 어둡게 덮는다 (SOMA-550).
 *
 * <p>슬라이드 넉 장을 먼저 읽히던 방식은 앱을 아직 못 본 사람에게 글만 읽히는 셈이었다.
 * 대신 첫 화면에서 누를 자리를 바로 비춘다 — 게임의 첫 조작 안내와 같다.
 *
 * <p>구멍은 이렇게 낸다. 비출 자리를 뺀 나머지를 검정 사각형 <b>넷</b>으로 덮는다.
 * 위·아래·왼쪽·오른쪽이다. 마스크(SVG·클리핑)가 필요 없어 안드로이드·아이폰이 같게 나오고,
 * 새 라이브러리도 들이지 않는다. 대신 조각끼리 겹치면 그 자리만 진해지므로 겹치지 않게 나눈다.
 *
 * <p>자리 계산만 여기 둔다. 그려 주는 일은 {@code components/spotlight-guide} 가 한다 —
 * 그래야 화면 없이 시험할 수 있다.
 */

export type Rect = { x: number; y: number; width: number; height: number };
export type Screen = { width: number; height: number };

export type SpotlightStep = {
  /** 비출 요소의 이름표 ({@code lib/spotlight-targets} 의 TARGET). */
  target: string;
  /** 문구 키. `<키>Title` 과 `<키>Body` 를 읽는다. */
  text: string;
  /** 동그란 버튼이면 true — 테두리를 원으로 두른다. */
  round?: boolean;
};

/** 비출 자리를 이만큼 넓힌다 — 버튼에 딱 붙으면 눌러야 할 곳이 좁아 보인다. */
export const HOLE_PADDING = 8;
/** 비출 자리와 설명 사이 틈. */
export const HOLE_GAP = 16;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 창 기준으로 잰 자리를, 덮개를 그리는 판 기준으로 옮긴다.
 *
 * <p>둘의 원점이 같지 않다. 실기기에서 덮개 판의 원점을 같은 방법으로 재 보니 창 기준으로
 * -28.19 였고, 구멍이 딱 그만큼 위로 밀려 있었다. 보정값을 짐작하는 대신, 판 자신을 재서
 * 그 차이를 뺀다 — 기기가 어떻든 두 값이 같은 방법으로 나오므로 어긋남이 상쇄된다.
 */
export function relativeTo(rect: Rect | null, origin: { x: number; y: number }): Rect | null {
  if (!rect) return null;
  return { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height };
}

/** 재어 온 자리를 여유만큼 넓히고 화면 안으로 자른다. 아직 못 쟀으면 null. */
export function holeOf(target: Rect | null, screen: Screen, padding = HOLE_PADDING): Rect | null {
  if (!target) return null;
  const left = clamp(target.x - padding, 0, screen.width);
  const top = clamp(target.y - padding, 0, screen.height);
  const right = clamp(target.x + target.width + padding, 0, screen.width);
  const bottom = clamp(target.y + target.height + padding, 0, screen.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * 비출 자리를 뺀 나머지를 덮을 사각형들. 비어 있는 조각(가장자리에 붙은 경우)은 버린다.
 *
 * <p>왼쪽·오른쪽 조각은 구멍의 높이만큼만 차지한다 — 위·아래 조각과 겹치지 않게.
 */
export function shroudRects(hole: Rect | null, screen: Screen): Rect[] {
  if (!hole) return [{ x: 0, y: 0, width: screen.width, height: screen.height }];
  const holeBottom = hole.y + hole.height;
  const holeRight = hole.x + hole.width;
  return [
    { x: 0, y: 0, width: screen.width, height: hole.y },
    { x: 0, y: holeBottom, width: screen.width, height: screen.height - holeBottom },
    { x: 0, y: hole.y, width: hole.x, height: hole.height },
    { x: holeRight, y: hole.y, width: screen.width - holeRight, height: hole.height },
  ].filter((r) => r.width > 0 && r.height > 0);
}

/**
 * 설명 카드를 놓을 높이. 비출 자리 아래가 기본이고, 아래가 모자라면 위로 올린다 —
 * 어느 쪽이든 비출 자리를 가리지 않는 게 먼저다.
 */
export function captionTop(
  hole: Rect | null,
  screen: Screen,
  captionHeight: number,
  gap = HOLE_GAP,
): number {
  if (!hole) return Math.max(0, (screen.height - captionHeight) / 2);
  const below = hole.y + hole.height + gap;
  if (below + captionHeight <= screen.height) return below;
  const above = hole.y - gap - captionHeight;
  if (above >= 0) return above;
  // 비출 자리가 화면을 거의 다 차지한다 — 가리더라도 화면 안에는 둔다.
  return clamp(below, 0, Math.max(0, screen.height - captionHeight));
}

/**
 * 사각형을 화면에 놓을 스타일로 바꾼다.
 *
 * <p><b>x·y 를 그대로 스타일에 넘기면 안 된다.</b> 리액트 네이티브에는 x·y 라는 스타일이 없어
 * 조용히 무시되고, 모든 조각이 왼쪽 위 구석(0,0)에 겹쳐 그려진다 — 실기기에서 화면 맨 위가
 * 비치던 것이 이것이었다. 자리 이름을 바꾸는 일을 한곳에 모아 다시 틀리지 않게 한다.
 */
export function rectStyle(rect: Rect): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  return { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
}

/** 다음 단계. 마지막이면 null(끝). */
export function stepAfter(index: number, total: number): number | null {
  return index + 1 < total ? index + 1 : null;
}

/** 가이드를 본 화면. 화면마다 따로 기억한다 — 홈을 봤다고 대본 가이드가 사라지면 안 된다. */
export type SpotlightTopic = 'home' | 'reading';

export function spotlightKey(topic: SpotlightTopic): string {
  return `acttub.spotlight.${topic}.seen`;
}
