/**
 * 대본 파일·글 입력의 기기 검사(reading.script). 네이티브 모듈 없이 성립하는 부분만 여기 산다 —
 * 실제 파일 읽기는 extract-file.ts 가 한다.
 */
import type { ScriptSource } from './types.ts';

/** 파일 한도. 글자를 뽑기 전에 기기에서 거른다. */
export const SCRIPT_FILE_MAX_BYTES = 20_000_000;

/** 한 번의 입력으로 이만큼 이상 늘면 붙여넣기로 본다. 사람은 이렇게 빨리 치지 못한다. */
const PASTE_MIN_CHARS = 30;

export type ScriptFileKind = 'txt' | 'docx' | 'pdf' | 'hwp' | 'unknown';

export type PickedScriptFile = { name: string; mimeType?: string | null; size?: number | null };

export function scriptFileKind(file: Pick<PickedScriptFile, 'name' | 'mimeType'>): ScriptFileKind {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  const mime = file.mimeType ?? '';
  if (ext === 'hwp' || ext === 'hwpx' || mime.includes('hwp')) return 'hwp';
  if (ext === 'txt' || mime.startsWith('text/')) return 'txt';
  if (ext === 'docx' || mime.includes('wordprocessingml')) return 'docx';
  if (ext === 'pdf' || mime.includes('pdf')) return 'pdf';
  return 'unknown';
}

export type ScriptFileCheck =
  | { ok: true; kind: Exclude<ScriptFileKind, 'hwp' | 'unknown'> }
  /** hwp·hwpx는 앱이 열지 않는다(1.0.0이 받아들인 한계). unsupported 는 그 밖의 형식. */
  | { ok: false; reason: 'too_large' | 'hwp' | 'unsupported' };

export function checkScriptFile(file: PickedScriptFile): ScriptFileCheck {
  if (typeof file.size === 'number' && file.size > SCRIPT_FILE_MAX_BYTES) return { ok: false, reason: 'too_large' };
  const kind = scriptFileKind(file);
  if (kind === 'hwp') return { ok: false, reason: 'hwp' };
  if (kind === 'unknown') return { ok: false, reason: 'unsupported' };
  return { ok: true, kind };
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
