/**
 * 배역 화면(D17)이 회차 시작 요청을 만드는 규칙(reading.cast·reading.session). 순수 함수라 화면 없이
 * 테스트한다. 웹 1.0.0 은 전체 구간으로 시작한다(구간 선택 UI 없음).
 */
import type { ReadingAdvance, ReadingMode, SessionCreateRequest } from "@/lib/reading/api-types";
import type { MaskMode } from "@/lib/reading/session/mask";
import { fullRange, myDialogueCount } from "@/lib/reading/session/range";
import type { StoredScript } from "@/lib/reading/storage";

export interface SessionStartInput {
  myCharacterIds: string[];
  mode: ReadingMode;
  advance: ReadingAdvance;
  record: boolean;
  /** 기기 설정. 서버에 보내지 않는다. */
  mask: MaskMode;
}

/**
 * 기본 선택은 그 대본의 마지막 회차의 내 배역이다. 회차가 없으면 아무것도 골라 두지 않는다.
 * 배역이 하나뿐인 대본은 그 배역이 내 배역이 된다.
 */
export function defaultMyCharacterIds(script: Pick<StoredScript, "characters" | "lastSession">): string[] {
  if (script.characters.length === 1) return [script.characters[0].id];
  const known = new Set(script.characters.map((c) => c.id));
  return (script.lastSession?.myCharacterIds ?? []).filter((id) => known.has(id));
}

export function rolesOf(script: Pick<StoredScript, "characters">, characterIds: string[]): string[] {
  const chosen = new Set(characterIds);
  return script.characters.filter((c) => chosen.has(c.id)).map((c) => c.name);
}

/** 모든 배역을 내 배역으로 고르면 기기가 읽는 줄이 없다 — 목소리 준비를 기다리지 않고 바로 시작한다. */
export function hasPartnerLines(script: Pick<StoredScript, "characters" | "lines" | "lineIds">, myCharacterIds: string[]): boolean {
  const mine = new Set(rolesOf(script, myCharacterIds));
  return script.lines.some((l) => l.type === "dialogue" && !mine.has(l.role));
}

export type StartCheck = { ok: true } | { ok: false; reason: "no_characters" | "empty_range" | "voice_not_ready" };

export function checkStart(
  script: Pick<StoredScript, "characters" | "lines" | "lineIds">,
  myCharacterIds: string[],
  voiceReady: boolean,
): StartCheck {
  if (myCharacterIds.length === 0) return { ok: false, reason: "no_characters" };
  if (myDialogueCount(script, rolesOf(script, myCharacterIds), fullRange(script)) === 0) return { ok: false, reason: "empty_range" };
  if (!voiceReady && hasPartnerLines(script, myCharacterIds)) return { ok: false, reason: "voice_not_ready" };
  return { ok: true };
}

/** 시작 요청 본문(요청 id 는 부르는 쪽이 붙인다). 대사가 없는 대본이면 null. */
export function buildSessionRequest(
  script: Pick<StoredScript, "lines" | "lineIds">,
  input: SessionStartInput,
): Omit<SessionCreateRequest, "request_id"> | null {
  const range = fullRange(script);
  if (!range) return null;
  return {
    my_character_ids: input.myCharacterIds,
    mode: input.mode,
    start_line_id: range.startLineId,
    end_line_id: range.endLineId,
    advance: input.advance,
    record: input.record,
  };
}

export const START_BUTTON = (n: number) => `선택한 ${n}개 배역으로 연습하기`;
