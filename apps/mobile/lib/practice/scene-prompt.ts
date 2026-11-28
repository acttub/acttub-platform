/**
 * 촬영 화면 대본 보기(프롬프터) — 「앞 줄(작게) → 지금 내 대사(크게) → 다음 줄(작게)」로 내 대사를 하나씩 넘긴다.
 * 글자 크기(작게·보통·크게)는 기기에 하나만 기억한다.
 *
 * ⚠️ 네이티브 모듈이 없는 환경(Node 테스트)에서도 불러올 수 있게 저장소는 함수 안 require 로만 닿는다.
 */
import { deviceStorage, type DeviceStorage } from '../device-storage.ts';
import type { RecordScriptLine } from './record-script.ts';

/** 넘길 대사 줄의 자리들. 내 대사가 없으면(배역을 모름) 대사 줄 전부를 넘긴다. */
export function promptStops(lines: readonly RecordScriptLine[]): number[] {
  const dialogue = lines.flatMap((l, i) => (l.kind === 'dialogue' ? [i] : []));
  const mine = dialogue.filter((i) => lines[i].mine);
  return mine.length > 0 ? mine : dialogue;
}

export type PromptView = {
  prev: RecordScriptLine | null;
  current: RecordScriptLine | null;
  next: RecordScriptLine | null;
  /** 1부터. */
  no: number;
  total: number;
};

/** 장면 머리 줄은 건너뛴다 — 앞·뒤로는 상대 대사와 지문만 보인다. */
function nearest(lines: readonly RecordScriptLine[], from: number, step: -1 | 1): RecordScriptLine | null {
  for (let i = from + step; i >= 0 && i < lines.length; i += step) {
    if (lines[i].kind !== 'scene') return lines[i];
  }
  return null;
}

export function promptView(lines: readonly RecordScriptLine[], at: number): PromptView {
  const stops = promptStops(lines);
  if (stops.length === 0) return { prev: null, current: null, next: null, no: 0, total: 0 };
  const k = clampPrompt(at, stops.length);
  const i = stops[k];
  return { prev: nearest(lines, i, -1), current: lines[i], next: nearest(lines, i, 1), no: k + 1, total: stops.length };
}

/** 끝에서는 그대로다. */
export function clampPrompt(at: number, total: number): number {
  return Math.max(0, Math.min(total - 1, at));
}

/** 지문은 괄호에 넣어 보인다(이미 괄호면 그대로). */
export function directionText(text: string): string {
  return text.trim().startsWith('(') ? text : `(${text})`;
}

export type PromptSize = 'small' | 'normal' | 'large';
export const PROMPT_SIZES: readonly PromptSize[] = ['small', 'normal', 'large'];
export const PROMPT_SIZE_KEY = 'acttub.promptSize';

/** 작게 → 보통 → 크게 → 작게. */
export function nextPromptSize(size: PromptSize): PromptSize {
  return PROMPT_SIZES[(PROMPT_SIZES.indexOf(size) + 1) % PROMPT_SIZES.length];
}

type Storage = Pick<DeviceStorage, 'getItem' | 'setItem'>;

function storage(): Storage | null {
  try {
    return deviceStorage() ?? null;
  } catch {
    return null;
  }
}

export async function loadPromptSize(store: Storage | null = storage()): Promise<PromptSize> {
  try {
    const saved = await store?.getItem(PROMPT_SIZE_KEY);
    if (saved && (PROMPT_SIZES as readonly string[]).includes(saved)) return saved as PromptSize;
  } catch {
    // 못 읽으면 보통.
  }
  return 'normal';
}

export async function savePromptSize(size: PromptSize, store: Storage | null = storage()): Promise<void> {
  try {
    await store?.setItem(PROMPT_SIZE_KEY, size);
  } catch {
    // 못 남겨도 이번 촬영에는 그대로다.
  }
}
