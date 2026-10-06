/**
 * 넣은 대본 글을 나눠 저장 요청 하나로 만든다(reading.script). 확인 화면 없이 나누자마자 저장한다.
 *
 * request_id는 초안이 만들어질 때 한 번 정한다. 연결이 끊겨 같은 초안을 다시 보내도 대본이 둘이
 * 되지 않기 위해서다(멱등).
 */
import { castOrder, countLinesByRole, parseScript, type ParsedScript } from './parse.ts';
import type { CreateScriptBody, CreateScriptLine, ScriptErrorCode, ScriptSource } from './types.ts';
import { translate as t } from '../i18n.ts';

/** 요구사항 「한도」. 서버와 같은 값이고 기기는 보내기 전에 먼저 거른다. */
export const SCRIPT_LIMITS = {
  /** 원문·줄 본문 총량. 유니코드 코드 포인트, 줄바꿈 포함. */
  rawTextMax: 100_000,
  linesMax: 3_000,
  charactersMax: 50,
} as const;

export type ScriptDraft = {
  requestId: string;
  rawText: string;
  source: ScriptSource;
};

export type DraftValidation = { ok: true; body: CreateScriptBody } | { ok: false; code: ScriptErrorCode };

export function createDraft(rawText: string, source: ScriptSource, requestId: string): ScriptDraft {
  return { requestId, rawText, source };
}

/** 유니코드 코드 포인트 수(서러게이트 쌍은 하나). 한도는 이 단위다. */
function codePoints(text: string): number {
  return text.length - (text.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g)?.length ?? 0);
}

/** 서버 계약: 제목은 공백 정리 뒤 1~200자. 넘치면 기기가 200자에서 자른다. */
const TITLE_MAX = 200;

function draftTitle(parsed: ParsedScript): string {
  const title = [...(parsed.title ?? '').trim()].slice(0, TITLE_MAX).join('');
  return title || t('reading.untitled');
}

/**
 * 저장할 배역 순서(서버 sort_order는 이 배열 순서다). 등장인물 목록이 있으면 그 순서가 먼저고,
 * 나머지는 대사 많은 순, 같으면 먼저 나온 순(파서 배역은 등장 순서라 안정 정렬이면 된다).
 */
function characterOrder(raw: string, parsed: ParsedScript): string[] {
  const listed = castOrder(raw, parsed.roles) ?? [];
  const counts = countLinesByRole(parsed.lines);
  const rest = parsed.roles
    .filter((role) => !listed.includes(role))
    .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
  return [...listed, ...rest];
}

function toCreateLines(parsed: ParsedScript, roles: string[]): CreateScriptLine[] {
  const index = new Map(roles.map((role, i) => [role, i] as const));
  return parsed.lines.map((line, i) => ({
    ordinal: i + 1,
    kind: line.type,
    character_index: line.type === 'dialogue' ? (index.get(line.role) ?? null) : null,
    text: line.text,
  }));
}

/** 나눠서 저장 본문을 만든다. 서버가 거절할 것은 기기가 먼저 거른다(같은 사유 코드). */
export function validateDraft(draft: ScriptDraft): DraftValidation {
  const parsed = parseScript(draft.rawText);
  if (parsed.roles.length === 0) return { ok: false, code: 'no_characters' };
  const roles = characterOrder(draft.rawText, parsed);
  const lines = toCreateLines(parsed, roles);
  const lineChars = lines.reduce((sum, l) => sum + codePoints(l.text), 0);
  if (
    codePoints(draft.rawText) > SCRIPT_LIMITS.rawTextMax ||
    lineChars > SCRIPT_LIMITS.rawTextMax ||
    lines.length > SCRIPT_LIMITS.linesMax ||
    roles.length > SCRIPT_LIMITS.charactersMax
  ) {
    return { ok: false, code: 'script_too_long' };
  }
  return {
    ok: true,
    body: {
      request_id: draft.requestId,
      title: draftTitle(parsed),
      source: draft.source,
      raw_text: draft.rawText,
      characters: roles.map((name) => ({ name })),
      lines,
    },
  };
}
