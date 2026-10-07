/**
 * 대본 파일·글 입력의 기기 검사(reading.script). 파일의 형식과 글자는 서버가 본다 — 기기는 올리기 전에 크기만 거른다.
 */
import type { ScriptSource } from './types.ts';

/** 서버 한도와 같다. 넘는 파일은 올리지 않는다. */
export const SCRIPT_FILE_MAX_BYTES = 50_000_000;

/** 한 번의 입력으로 이만큼 이상 늘면 붙여넣기로 본다. 사람은 이렇게 빨리 치지 못한다. */
const PASTE_MIN_CHARS = 30;

export function isScriptFileTooLarge(bytes: number): boolean {
  return bytes > SCRIPT_FILE_MAX_BYTES;
}

/**
 * 글 상자가 바뀔 때 입력 경로를 정한다. 파일·예시는 한 번 정해지면 손봐도 그대로이고, 붙여넣기도
 * 그 뒤에 고친 것은 붙여넣기다. 다 지우면 처음으로 돌아간다.
 */
export function nextTextSource(current: ScriptSource | null, previous: string, next: string): ScriptSource | null {
  if (next.length === 0) return null;
  if (current === 'file' || current === 'sample' || current === 'paste') return current;
  return next.length - previous.length >= PASTE_MIN_CHARS ? 'paste' : 'typed';
}
