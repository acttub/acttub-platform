/**
 * 회차 설정(R02·R03, reading.cast · reading.session)의 순수 계산 — 장면 경계, 대사 번호, 구간 당기기,
 * 기기 사전 검사, 시작 요청 본문. 화면·서버를 모른다.
 */
import type { ScriptLine } from './parse.ts';
import type { ReadingAdvance, ReadingMode, StartSessionBody } from './types.ts';

export type SceneRange = {
  label: string;
  /** 그 장면 안 첫 대사 줄 인덱스(lines 기준). */
  startIndex: number;
  /** 그 장면 안 마지막 대사 줄 인덱스. */
  endIndex: number;
  dialogueCount: number;
};

/** 대사 번호 — 대사 줄만 1부터, 지문·장면은 null(저장하지 않고 줄 순서에서 센다). */
export function dialogueNumbers(lines: ScriptLine[]): (number | null)[] {
  let n = 0;
  return lines.map((l) => (l.type === 'dialogue' ? ++n : null));
}

/**
 * "장면으로 찾기"의 후보. 장면 줄(막·장 머리)이 있으면 그 줄이 경계이고, 없으면 지문이 경계다.
 * 장면을 고르면 그 장면 안 첫·마지막 대사가 구간이 되므로 대사가 없는 장면은 없앤다.
 */
export function sceneRanges(lines: ScriptLine[]): SceneRange[] {
  const boundary: ScriptLine['type'] = lines.some((l) => l.type === 'scene') ? 'scene' : 'direction';
  const out: SceneRange[] = [];
  let label: string | null = null;
  let first = -1;
  let last = -1;
  let count = 0;
  let sceneNo = 0;
  const close = () => {
    if (label !== null && first >= 0) out.push({ label, startIndex: first, endIndex: last, dialogueCount: count });
    first = -1;
    last = -1;
    count = 0;
  };
  lines.forEach((l, i) => {
    if (l.type === boundary) {
      close();
      sceneNo += 1;
      label = boundary === 'scene' ? l.text : `장면 ${sceneNo}`;
      return;
    }
    if (l.type !== 'dialogue') return;
    if (label === null) {
      sceneNo += 1;
      label = `장면 ${sceneNo}`;
    }
    if (first < 0) first = i;
    last = i;
    count += 1;
  });
  close();
  return out;
}

/** 시작·끝 선택이 지문·장면에 걸리면 안쪽 대사로 당긴다. 대사가 없으면 null. */
export function snapRangeToDialogues(
  lines: ScriptLine[],
  start: number,
  end: number,
): { startIndex: number; endIndex: number } | null {
  let s = -1;
  let e = -1;
  for (let i = Math.max(0, start); i <= end && i < lines.length; i++) {
    if (lines[i].type !== 'dialogue') continue;
    if (s < 0) s = i;
    e = i;
  }
  return s < 0 ? null : { startIndex: s, endIndex: e };
}

/** 구간 안에 내 대사가 없거나 시작 줄이 끝 줄 뒤면 empty_range(서버와 같은 코드). */
export function rangeError(lines: ScriptLine[], myRoles: string[], start: number, end: number): 'empty_range' | null {
  if (start > end) return 'empty_range';
  const mine = new Set(myRoles);
  for (let i = start; i <= end && i < lines.length; i++) {
    const l = lines[i];
    if (l.type === 'dialogue' && mine.has(l.role)) return null;
  }
  return 'empty_range';
}

export function buildStartBody(input: {
  requestId: string;
  myCharacterIds: string[];
  mode: ReadingMode;
  startLineId: string;
  endLineId: string;
  advance: ReadingAdvance;
  record: boolean;
}): StartSessionBody {
  return {
    request_id: input.requestId,
    my_character_ids: input.myCharacterIds,
    mode: input.mode,
    start_line_id: input.startLineId,
    end_line_id: input.endLineId,
    advance: input.advance,
    record: input.record,
  };
}

/**
 * 배역 화면의 기본 선택 — 마지막 회차의 내 배역. 회차가 없으면 아무것도 골라 두지 않는다.
 * 배역이 하나뿐인 대본은 그 배역이 내 배역이다(화면은 확인만 받는다).
 */
export function defaultMyCharacterIds(script: {
  last_session: { my_character_ids: string[] } | null;
  characters: { id: string }[];
}): string[] {
  if (script.characters.length === 1) return [script.characters[0].id];
  const known = new Set(script.characters.map((c) => c.id));
  return (script.last_session?.my_character_ids ?? []).filter((id) => known.has(id));
}
