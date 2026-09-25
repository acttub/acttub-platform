/**
 * 가리기(reading.session). 기기 설정이며 서버에 없다. 대사 본문에만 걸리고 배역 이름·지문·장면은 남긴다.
 * quiz 에서는 내 대사가 언제나 가려진다(일반 설정보다 우선). "원문 보기"는 그 줄만 잠깐 푼다.
 * 기기는 대본마다 마지막 값을 기억한다.
 */
import type { ReadingMode } from "@/lib/reading/api-types";

export type MaskMode = "show_all" | "hide_mine" | "hide_all";

export const MASK_MODES: { value: MaskMode; label: string }[] = [
  { value: "show_all", label: "모든 대사 보기" },
  { value: "hide_mine", label: "내 대사만 가리기" },
  { value: "hide_all", label: "모든 대사 가리기" },
];

export function maskLabel(mode: MaskMode): string {
  return MASK_MODES.find((m) => m.value === mode)?.label ?? "";
}

export function isMasked(mask: MaskMode, line: { mine: boolean; mode: ReadingMode; revealed?: boolean }): boolean {
  if (line.revealed) return false;
  if (line.mode === "quiz" && line.mine) return true;
  if (mask === "hide_all") return true;
  if (mask === "hide_mine") return line.mine;
  return false;
}

const MASK_KEY = "acttub.reading.mask";

function store(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readAll(): Record<string, MaskMode> {
  try {
    const raw = store()?.getItem(MASK_KEY);
    return raw ? (JSON.parse(raw) as Record<string, MaskMode>) : {};
  } catch {
    return {};
  }
}

/** 그 대본에서 마지막으로 쓴 가리기. 없으면 모든 대사 보기. */
export function loadMask(scriptId: string): MaskMode {
  const v = readAll()[scriptId];
  return v === "hide_mine" || v === "hide_all" ? v : "show_all";
}

export function saveMask(scriptId: string, mode: MaskMode): void {
  try {
    store()?.setItem(MASK_KEY, JSON.stringify({ ...readAll(), [scriptId]: mode }));
  } catch {
    /* 저장이 막힌 환경이면 이번 회차만 기억한다 */
  }
}
