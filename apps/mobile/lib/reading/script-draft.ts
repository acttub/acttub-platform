/**
 * 대본 확인 화면(reading.script)의 초안. 원문을 잠시 들고 있다가 배우가 배역을 고친 결과와 원문을
 * 한 요청으로 서버에 보낸다. 화면을 떠나면 버린다 — 저장 전에는 서버에 아무것도 남지 않는다.
 *
 * 저장 뒤에는 줄 구조가 고정이므로 배역을 빼고 더하는 것은 여기서만 한다. 빼기·더하기는 파서에
 * 다시 맡기고(excludeRoles·roleHints), 이름 고치기는 파서 이름(key)에 표시 이름을 덧씌운다 — 줄의
 * 배역 연결(character_index)은 그대로다.
 *
 * request_id는 초안이 만들어질 때 한 번 정한다. 연결이 끊겨 같은 초안을 다시 보내도 대본이 둘이
 * 되지 않기 위해서다(멱등).
 */
import { parseScript, type ParsedScript } from './parse.ts';
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
  /** 배우가 고친 제목. null이면 파서가 뽑은 제목(없으면 "제목 없는 대본"). */
  title: string | null;
  /** 배역에서 뺀 파서 이름. 그 이름의 줄은 지문이 된다. */
  excluded: string[];
  /** 배우가 더한 이름. 본문에 나오는 것만 파서가 채택한다. */
  hints: string[];
  /** 파서 이름 → 표시 이름. */
  renames: Record<string, string>;
};

export type DraftCharacter = {
  /** 파서가 아는 이름. 빼기·이름 고치기의 열쇠다. */
  key: string;
  /** 저장될 이름. */
  name: string;
  dialogueCount: number;
};

export type DraftSummary = { characters: number; dialogues: number; directions: number; scenes: number };

export type DraftValidation = { ok: true; body: CreateScriptBody } | { ok: false; code: ScriptErrorCode };

export function createDraft(rawText: string, source: ScriptSource, requestId: string): ScriptDraft {
  return { requestId, rawText, source, title: null, excluded: [], hints: [], renames: {} };
}

export function draftParsed(draft: ScriptDraft): ParsedScript {
  return parseScript(draft.rawText, { excludeRoles: draft.excluded, roleHints: draft.hints });
}

/** 유니코드 코드 포인트 수(서러게이트 쌍은 하나). 한도는 이 단위다. */
function codePoints(text: string): number {
  return text.length - (text.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g)?.length ?? 0);
}

function displayName(draft: ScriptDraft, key: string): string {
  const renamed = draft.renames[key];
  return (renamed ?? key).trim();
}

export function draftCharacters(draft: ScriptDraft): DraftCharacter[] {
  const parsed = draftParsed(draft);
  const counts = new Map<string, number>();
  for (const line of parsed.lines) {
    if (line.type === 'dialogue') counts.set(line.role, (counts.get(line.role) ?? 0) + 1);
  }
  return parsed.roles.map((key) => ({ key, name: displayName(draft, key), dialogueCount: counts.get(key) ?? 0 }));
}

export function draftSummary(draft: ScriptDraft): DraftSummary {
  const parsed = draftParsed(draft);
  const summary: DraftSummary = { characters: parsed.roles.length, dialogues: 0, directions: 0, scenes: 0 };
  for (const line of parsed.lines) {
    if (line.type === 'dialogue') summary.dialogues += 1;
    else if (line.type === 'direction') summary.directions += 1;
    else summary.scenes += 1;
  }
  return summary;
}

export function draftTitle(draft: ScriptDraft): string {
  const title = (draft.title ?? draftParsed(draft).title ?? '').trim();
  return title || t('reading.untitled');
}

export function setDraftTitle(draft: ScriptDraft, title: string): ScriptDraft {
  return { ...draft, title };
}

export function renameDraftCharacter(draft: ScriptDraft, key: string, name: string): ScriptDraft {
  return { ...draft, renames: { ...draft.renames, [key]: name } };
}

/** 뺀 이름은 힌트에서도 지운다 — 사람이 내린 판단이 먼저다(parse.ts). */
export function removeDraftCharacter(draft: ScriptDraft, key: string): ScriptDraft {
  return {
    ...draft,
    excluded: draft.excluded.includes(key) ? draft.excluded : [...draft.excluded, key],
    hints: draft.hints.filter((h) => h !== key),
  };
}

/**
 * 이름을 더한다. 본문에 그 이름으로 말한 줄이 있어야 배역이 된다(없으면 added=false).
 * 앞서 뺀 이름을 다시 더하면 빼기를 되돌린다.
 */
export function addDraftCharacter(draft: ScriptDraft, rawName: string): { draft: ScriptDraft; added: boolean } {
  const name = rawName.trim();
  if (!name) return { draft, added: false };
  const next: ScriptDraft = {
    ...draft,
    excluded: draft.excluded.filter((e) => e !== name),
    hints: draft.hints.includes(name) ? draft.hints : [...draft.hints, name],
  };
  const added = draftParsed(next).roles.includes(name);
  return { draft: added ? next : draft, added };
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

/** 서버가 거절할 것을 기기가 먼저 거른다. 같은 사유 코드를 쓴다. */
export function validateDraft(draft: ScriptDraft): DraftValidation {
  const parsed = draftParsed(draft);
  if (parsed.roles.length === 0) return { ok: false, code: 'no_characters' };
  const names = parsed.roles.map((key) => displayName(draft, key));
  if (names.some((n) => n.length === 0) || new Set(names).size !== names.length) {
    return { ok: false, code: 'invalid_characters' };
  }
  const lines = toCreateLines(parsed, parsed.roles);
  const lineChars = lines.reduce((sum, l) => sum + codePoints(l.text), 0);
  if (
    codePoints(draft.rawText) > SCRIPT_LIMITS.rawTextMax ||
    lineChars > SCRIPT_LIMITS.rawTextMax ||
    lines.length > SCRIPT_LIMITS.linesMax ||
    parsed.roles.length > SCRIPT_LIMITS.charactersMax
  ) {
    return { ok: false, code: 'script_too_long' };
  }
  return {
    ok: true,
    body: {
      request_id: draft.requestId,
      title: draftTitle(draft),
      source: draft.source,
      raw_text: draft.rawText,
      characters: names.map((name) => ({ name })),
      lines,
    },
  };
}

export function draftToCreateBody(draft: ScriptDraft): CreateScriptBody {
  const result = validateDraft(draft);
  if (!result.ok) throw new Error(result.code);
  return result.body;
}
