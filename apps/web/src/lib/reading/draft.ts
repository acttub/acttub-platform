/**
 * 확인 화면(D16)의 초안 — 원문과 배우가 고친 것(제목·더한 이름·뺀 배역·고친 이름)을 들고 있다가
 * 저장 요청으로 바꾼다(reading.script). 순수 모듈이라 화면 없이 테스트한다.
 *
 * 파서는 원래 이름으로 줄을 나누고, 고친 이름은 저장 요청의 배역 이름에만 실린다. 그래서 이름을
 * 고쳐도 줄과 배역의 연결은 그대로다. 뺀 배역의 줄은 지문이 되고, 더한 이름의 줄은 대사가 된다.
 * 확인 화면에서 나가면 초안은 버려지고 서버에는 아무것도 남지 않는다.
 */
import type { ScriptCreateRequest, ScriptSource } from "./api-types";
import { countByKind, countLinesByRole, parseScript, type LineKind, type ParsedScript } from "./script/parse";

/** 서버와 같은 한도. 넘으면 보내기 전에 막는다 — 서버의 422 script_too_long 과 같은 규칙이다. */
export const SCRIPT_LIMITS = {
  /** 원문, 유니코드 코드 포인트(줄바꿈 포함) */
  rawCodePoints: 100_000,
  /** 줄 본문의 총량, 유니코드 코드 포인트 */
  lineTextCodePoints: 100_000,
  /** 대사·지문·장면 모두 */
  lines: 3_000,
  characters: 50,
} as const;

/** 파서가 제목을 못 찾았고 배우도 적지 않았을 때 */
export const DEFAULT_TITLE = "제목 없는 대본";
/** 서버 규칙: 제목은 공백 정리 뒤 1~200자 */
export const TITLE_MAX_LENGTH = 200;

export interface ScriptDraft {
  raw: string;
  source: ScriptSource;
  /** 확인 화면에서 적은 제목. null 이면 파서가 찾은 제목이나 기본 제목을 쓴다. */
  title: string | null;
  /** 빠진 배역으로 더한 이름 */
  hints: string[];
  /** 배역에서 뺀 이름(파서가 잡은 원래 이름) */
  excluded: string[];
  /** 원래 이름 → 고친 이름 */
  renames: Record<string, string>;
}

export type DraftChange =
  | { raw: string }
  | { title: string }
  | { exclude: string }
  | { include: string }
  | { addHint: string }
  | { removeHint: string }
  | { rename: { from: string; to: string } };

export function newDraft(raw: string, source: ScriptSource): ScriptDraft {
  return { raw, source, title: null, hints: [], excluded: [], renames: {} };
}

export function updateDraft(draft: ScriptDraft, change: DraftChange): ScriptDraft {
  if ("raw" in change) {
    // 본문이 바뀌면 배역 후보도 바뀐다. 고친 것은 남겨 두되 본문에 없는 이름은 뒤에서 걸러진다.
    return { ...draft, raw: change.raw };
  }
  if ("title" in change) return { ...draft, title: change.title };
  if ("exclude" in change) {
    return draft.excluded.includes(change.exclude) ? draft : { ...draft, excluded: [...draft.excluded, change.exclude] };
  }
  if ("include" in change) return { ...draft, excluded: draft.excluded.filter((n) => n !== change.include) };
  if ("addHint" in change) {
    const name = change.addHint.trim();
    if (!name || draft.hints.includes(name)) return draft;
    // 뺐던 이름을 다시 적으면 되살린 것으로 본다.
    return { ...draft, hints: [...draft.hints, name], excluded: draft.excluded.filter((n) => n !== name) };
  }
  if ("removeHint" in change) return { ...draft, hints: draft.hints.filter((n) => n !== change.removeHint) };
  const { from, to } = change.rename;
  return { ...draft, renames: { ...draft.renames, [from]: to } };
}

export interface DraftCharacter {
  /** 파서가 잡은 이름. 줄은 이 이름으로 매달려 있다. */
  original: string;
  /** 화면에 보이고 저장에 실리는 이름(앞뒤 공백 정리) */
  name: string;
  excluded: boolean;
  /** 뺀 배역이어도 원래 대사 수를 보여 준다 — 되살릴지 판단하는 근거다. */
  dialogueCount: number;
}

export interface ResolvedDraft {
  /** 뺀 배역을 적용한 결과. 저장 요청과 화면의 줄 목록이 이것을 쓴다. */
  parsed: ParsedScript;
  title: string;
  /** 후보 배역 전부(뺀 것 포함), 등장 순서 */
  characters: DraftCharacter[];
  counts: Record<LineKind, number>;
}

function displayName(draft: ScriptDraft, original: string): string {
  const renamed = draft.renames[original];
  return renamed === undefined ? original : renamed.trim();
}

export function resolveDraft(draft: ScriptDraft): ResolvedDraft {
  const options = { roleHints: draft.hints };
  const all = parseScript(draft.raw, options);
  const parsed = parseScript(draft.raw, { ...options, excludeRoles: draft.excluded });
  const counts = countLinesByRole(all.lines);
  const characters = all.roles.map((original) => ({
    original,
    name: displayName(draft, original),
    excluded: draft.excluded.includes(original),
    dialogueCount: counts.get(original) ?? 0,
  }));
  const title = (draft.title?.trim() || parsed.title || DEFAULT_TITLE).slice(0, TITLE_MAX_LENGTH);
  return { parsed, title, characters, counts: countByKind(parsed.lines) };
}

export type DraftCheck = { ok: true } | { ok: false; code: "no_characters" | "invalid_characters" | "script_too_long" };

/** 유니코드 코드 포인트 수. 서버가 같은 단위로 센다. 이모지 하나가 한 글자다. */
function codePoints(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // 서로게이트 쌍은 한 글자다
    if (c >= 0xd800 && c <= 0xdbff) i++;
    n++;
  }
  return n;
}

/** 저장해도 되는가. 서버가 422 로 거절할 것을 보내기 전에 같은 사유로 막는다. */
export function checkDraft(draft: ScriptDraft): DraftCheck {
  const { parsed, characters } = resolveDraft(draft);
  const kept = characters.filter((c) => !c.excluded);
  if (kept.length === 0) return { ok: false, code: "no_characters" };
  const names = kept.map((c) => c.name);
  if (names.some((n) => n === "") || new Set(names).size !== names.length) {
    return { ok: false, code: "invalid_characters" };
  }
  if (
    codePoints(draft.raw) > SCRIPT_LIMITS.rawCodePoints ||
    parsed.lines.length > SCRIPT_LIMITS.lines ||
    kept.length > SCRIPT_LIMITS.characters ||
    parsed.lines.reduce((sum, l) => sum + codePoints(l.text), 0) > SCRIPT_LIMITS.lineTextCodePoints
  ) {
    return { ok: false, code: "script_too_long" };
  }
  return { ok: true };
}

/** 저장 요청 본문(요청 id 는 부르는 쪽이 붙인다)과 검사 결과. */
export function toCreateRequest(draft: ScriptDraft): { request: Omit<ScriptCreateRequest, "request_id">; check: DraftCheck } {
  const { parsed, title, characters } = resolveDraft(draft);
  const kept = characters.filter((c) => !c.excluded);
  const indexOf = new Map(kept.map((c, i) => [c.original, i]));
  const request = {
    title,
    source: draft.source,
    raw_text: draft.raw,
    characters: kept.map((c) => ({ name: c.name })),
    lines: parsed.lines.map((l, i) => ({
      ordinal: i + 1,
      kind: l.type,
      character_index: l.type === "dialogue" ? (indexOf.get(l.role) ?? null) : null,
      text: l.text,
    })),
  };
  return { request, check: checkDraft(draft) };
}
