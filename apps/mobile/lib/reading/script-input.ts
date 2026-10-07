/**
 * 대본 넣기(R2) 화면의 입력 상태. 「파일로 넣기 | 글로 붙여넣기」 탭이 내용을 따로 들고, [다음]은 보고 있는
 * 탭의 것을 보낸다. 파일은 고르는 순간 서버에 올려 두고(글자는 서버가 뽑는다) [다음]은 그 upload_id 를 보낸다.
 */
import { nextTextSource } from './file-input.ts';
import { SAMPLE_SCRIPT } from './sample.ts';
import type { ImportInput, PickedScriptFile } from './script-import.ts';
import type { ScriptSource } from './types.ts';

export type ScriptTab = 'file' | 'paste';

export type FileSlot =
  | { kind: 'empty' }
  | { kind: 'reading'; file: PickedScriptFile }
  /** 올려 둔 파일. 서버가 아직 못 읽었어도(읽기 자리 없음) 여기 두고 [다음]이 다시 읽는다. */
  | { kind: 'ready'; file: PickedScriptFile; uploadId: string };

export type ScriptInput = {
  tab: ScriptTab;
  file: FileSlot;
  paste: { text: string; source: ScriptSource | null };
  /** 파일을 한 번이라도 골랐다(읽기 실패 포함). 그 뒤로는 예시 링크를 보이지 않는다. */
  triedFile: boolean;
};

export type ScriptInputAction =
  | { type: 'tab'; tab: ScriptTab }
  | { type: 'fileReading'; file: PickedScriptFile }
  | { type: 'fileUploaded'; uploadId: string }
  | { type: 'fileFailed' }
  | { type: 'paste'; text: string }
  | { type: 'sample' };

const EMPTY_PASTE: ScriptInput['paste'] = { text: '', source: null };

/** 기본은 파일 탭. 예시로 들어오면 글 탭에 예시를 채운 채 연다. */
export function initialScriptInput(sample: boolean): ScriptInput {
  const base: ScriptInput = { tab: 'file', file: { kind: 'empty' }, paste: EMPTY_PASTE, triedFile: false };
  return sample ? scriptInputReducer(base, { type: 'sample' }) : base;
}

export function scriptInputReducer(state: ScriptInput, action: ScriptInputAction): ScriptInput {
  switch (action.type) {
    case 'tab':
      return { ...state, tab: action.tab };
    case 'fileReading':
      return { ...state, file: { kind: 'reading', file: action.file }, triedFile: true };
    case 'fileUploaded':
      return state.file.kind === 'empty' ? state : { ...state, file: { kind: 'ready', file: state.file.file, uploadId: action.uploadId } };
    case 'fileFailed':
      return { ...state, file: { kind: 'empty' } };
    case 'paste':
      return { ...state, paste: { text: action.text, source: nextTextSource(state.paste.source, state.paste.text, action.text) } };
    case 'sample':
      return { ...state, tab: 'paste', paste: { text: SAMPLE_SCRIPT, source: 'sample' } };
  }
}

/**
 * [다음]이 보낼 것. 보고 있는 탭에 보낼 것이 없으면 null(버튼이 꺼진다). 파일을 올리는 동안에는 어느 탭이든 null —
 * 올리기 결과(실패·동의) 팝업이 나누는 중 팝업을 덮고 작업이 둘이 되지 않게.
 */
export function pendingScript(state: ScriptInput): ImportInput | null {
  if (state.file.kind === 'reading') return null;
  if (state.tab === 'file') return state.file.kind === 'ready' ? { kind: 'file', file: state.file.file, uploadId: state.file.uploadId } : null;
  const text = state.paste.text.trim();
  return text ? { kind: 'text', text, source: state.paste.source ?? 'typed' } : null;
}

/** 「예시 대본으로 시작해보기」는 아무것도 넣지 않은 빈 상태에만 보인다. */
export function showsSampleLink(state: ScriptInput): boolean {
  return !state.triedFile && state.paste.text.length === 0;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

