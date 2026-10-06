/**
 * 대본 넣기(R2) 화면의 입력 상태. 「파일로 넣기 | 글로 붙여넣기」 탭이 내용을 따로 들고, [다음]은 보고 있는
 * 탭의 것을 보낸다. 파일에서 뽑은 글은 붙여넣기 칸에 펼치지 않는다.
 */
import { nextTextSource } from './file-input.ts';
import { SAMPLE_SCRIPT } from './sample.ts';
import type { ScriptDraft } from './script-draft.ts';
import type { ScriptSource } from './types.ts';
import { translate as t } from '../i18n.ts';

export type ScriptTab = 'file' | 'paste';

export type FileSlot =
  | { kind: 'empty' }
  | { kind: 'reading'; name: string; size: number | null }
  | { kind: 'ready'; name: string; size: number | null; text: string };

export type ScriptInput = {
  tab: ScriptTab;
  file: FileSlot;
  paste: { text: string; source: ScriptSource | null };
  /** 파일을 한 번이라도 골랐다(읽기 실패 포함). 그 뒤로는 예시 링크를 보이지 않는다. */
  triedFile: boolean;
};

export type ScriptInputAction =
  | { type: 'tab'; tab: ScriptTab }
  | { type: 'fileReading'; name: string; size: number | null }
  | { type: 'fileRead'; text: string }
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
      return { ...state, file: { kind: 'reading', name: action.name, size: action.size }, triedFile: true };
    case 'fileRead':
      return state.file.kind === 'reading' ? { ...state, file: { ...state.file, kind: 'ready', text: action.text } } : state;
    case 'fileFailed':
      return { ...state, file: { kind: 'empty' } };
    case 'paste':
      return { ...state, paste: { text: action.text, source: nextTextSource(state.paste.source, state.paste.text, action.text) } };
    case 'sample':
      return { ...state, tab: 'paste', paste: { text: SAMPLE_SCRIPT, source: 'sample' } };
  }
}

/** [다음]이 보낼 글. 보고 있는 탭에 보낼 것이 없으면 null(버튼이 꺼진다). */
export function pendingScript(state: ScriptInput): { text: string; source: ScriptSource } | null {
  if (state.tab === 'file') return state.file.kind === 'ready' ? { text: state.file.text, source: 'file' } : null;
  const text = state.paste.text.trim();
  return text ? { text, source: state.paste.source ?? 'typed' } : null;
}

/** 「예시 대본으로 시작해보기」는 아무것도 넣지 않은 빈 상태에만 보인다. */
export function showsSampleLink(state: ScriptInput): boolean {
  return !state.triedFile && state.paste.text.length === 0;
}

/** 같은 글을 다시 보내면 같은 초안(같은 request_id)을 쓴다 — 저장 실패 뒤 [다음]을 다시 눌러도 대본이 하나다. */
export function sameDraft(draft: ScriptDraft | null, pending: { text: string; source: ScriptSource }): draft is ScriptDraft {
  return !!draft && draft.rawText === pending.text && draft.source === pending.source;
}

function groupDigits(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** 고른 파일 상자 둘째 줄 — "1.2MB · 글 4,812자". */
export function fileMeta(file: { size: number | null; text: string }): string {
  const chars = t('reading.fileChars', { count: groupDigits([...file.text].length) });
  return file.size === null ? chars : `${formatFileSize(file.size)} · ${chars}`;
}
