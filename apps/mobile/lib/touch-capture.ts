/**
 * 버튼 탭 기록. 앱 맨 바깥 View 의 onTouchEndCapture 가 손을 뗀 자리의 React 트리를 받아,
 * 그 자리를 감싼 가장 가까운 "누를 수 있는 요소"(onPress·onLongPress 가 있는 것)의 이름을 뽑는다.
 *
 * 누를 수 없는 자리(빈 배경·스크롤)는 기록하지 않는다. 이름은 ph-label → accessibilityLabel →
 * 안에 든 글자 → testID 순서로 고른다. 운영 빌드는 컴포넌트 이름이 줄어들므로 쓰지 않는다.
 * 누른 요소 바깥에 붙은 ph-label 은 구역 이름(area)으로 따로 남긴다. 'ph-no-capture' 가 붙은 요소 안의 탭은 버린다.
 *
 * ⚠️ lib/posthog.ts 와 같은 규칙 — CI 는 설치 없이 node --test 로 읽으므로 import 를 두지 않는다.
 */

export const LABEL_PROP = 'ph-label';
export const NO_CAPTURE_PROP = 'ph-no-capture';

const MAX_ANCESTORS = 200;
const MAX_TEXT_NODES = 300;
const MAX_LABEL_LENGTH = 80;
const FIBER_KEY = /^__react(Fiber|InternalInstance)\$/;

type Props = Record<string, unknown> | null | undefined;

export type FiberLike = {
  memoizedProps?: Props;
  return?: FiberLike | null;
  child?: FiberLike | null;
  sibling?: FiberLike | null;
};

export type TouchEventLike = {
  _targetInst?: FiberLike | null;
  target?: unknown;
  nativeEvent?: { pageX?: number; pageY?: number };
};

export type TapLabelSource = 'ph-label' | 'accessibilityLabel' | 'text' | 'testID' | 'none';

export type Tap = {
  label: string;
  source: TapLabelSource;
  /** 누른 요소를 감싼 바깥쪽 ph-label(구역 이름). 없으면 빈 값. */
  area?: string;
  x?: number;
  y?: number;
};

function isPressable(props: Props): boolean {
  return !!props && (typeof props.onPress === 'function' || typeof props.onLongPress === 'function');
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

function clip(text: string): string {
  return text.length > MAX_LABEL_LENGTH ? `${text.slice(0, MAX_LABEL_LENGTH - 1)}…` : text;
}

function targetFiber(e: TouchEventLike): FiberLike | null {
  if (e._targetInst) return e._targetInst;
  // 이벤트에 인스턴스가 없을 때는 대상 노드에 붙은 React 내부 키에서 찾는다.
  let node = e.target as Record<string, unknown> | null | undefined;
  for (let depth = 0; node && typeof node === 'object' && depth < 100; depth++) {
    const key = Object.getOwnPropertyNames(node).find((name) => FIBER_KEY.test(name));
    if (key) return node[key] as FiberLike;
    node = node.parentNode as Record<string, unknown> | null | undefined;
  }
  return null;
}

/** 요소 안에 보이는 글자를 순서대로 모은다. 같은 글자가 Text·호스트 노드에 겹쳐 있으면 한 번만 쓴다. */
export function textInside(root: FiberLike): string {
  const parts: string[] = [];
  const stack: FiberLike[] = [];
  if (root.child) stack.push(root.child);
  let visited = 0;
  while (stack.length && visited < MAX_TEXT_NODES) {
    const fiber = stack.pop()!;
    visited++;
    if (fiber.sibling) stack.push(fiber.sibling);
    const children = fiber.memoizedProps?.children;
    const pieces = Array.isArray(children) ? children : [children];
    const own = nonEmpty(
      pieces.filter((p) => typeof p === 'string' || typeof p === 'number').join(''),
    );
    if (own && parts[parts.length - 1] !== own) parts.push(own);
    if (fiber.child) stack.push(fiber.child);
    if (parts.join(' ').length > MAX_LABEL_LENGTH) break;
  }
  return parts.join(' ');
}

/** 탭 한 번을 기록할 값으로 바꾼다. 기록하지 않을 탭이면 null. */
export function tapFromTouch(e: TouchEventLike): Tap | null {
  let fiber = targetFiber(e);
  let pressable: FiberLike | null = null;
  let inner: string | null = null; // 손 끝 ~ 누른 요소 사이에 붙은 ph-label
  let area: string | null = null; // 누른 요소 바깥쪽에 붙은 ph-label
  for (let depth = 0; fiber && depth < MAX_ANCESTORS; depth++) {
    const props = fiber.memoizedProps;
    if (props?.[NO_CAPTURE_PROP]) return null;
    const label = nonEmpty(props?.[LABEL_PROP]);
    if (!pressable) {
      if (!inner) inner = label;
      if (isPressable(props)) pressable = fiber;
    } else if (!area && label) {
      area = label;
    }
    fiber = fiber.return ?? null;
  }
  if (!pressable) return null;

  const props = pressable.memoizedProps;
  const base = {
    x: e.nativeEvent?.pageX,
    y: e.nativeEvent?.pageY,
    ...(area ? { area: clip(area) } : {}),
  };
  if (inner) return { label: clip(inner), source: 'ph-label', ...base };
  const a11y = nonEmpty(props?.accessibilityLabel) ?? nonEmpty(props?.['aria-label']);
  if (a11y) return { label: clip(a11y), source: 'accessibilityLabel', ...base };
  const text = textInside(pressable);
  if (text) return { label: clip(text), source: 'text', ...base };
  const testID = nonEmpty(props?.testID);
  if (testID) return { label: clip(testID), source: 'testID', ...base };
  return { label: '', source: 'none', ...base };
}
