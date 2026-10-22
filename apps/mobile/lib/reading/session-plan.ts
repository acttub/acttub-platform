/**
 * 새 연습(R8, reading.cast · reading.session)의 순수 계산 — 대사 번호, 구간 이름의 글, 구간 당기기, 최근 구간,
 * 내 배역 기본값, 시작 가능 여부, 기기 사전 검사, 시작 요청 본문. 장면 나누기·구간 이름은 서버가 정한다. 화면·서버를 모른다.
 */
import type { RangeName, ScriptCharacter, ScriptLine, SessionCard, StartSessionBody } from './types.ts';

/** 대사 번호 — 대사 줄만 1부터, 지문·장면은 null(저장하지 않고 줄 순서에서 센다). */
export function dialogueNumbers(lines: ScriptLine[]): (number | null)[] {
  let n = 0;
  return lines.map((l) => (l.type === 'dialogue' ? ++n : null));
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function sceneTitle(scene: { title: string | null; no: number }, t: Translate): string {
  return scene.title ?? t('reading.rangeScene', { n: scene.no });
}

export function rangeTitle(name: RangeName, t: Translate): string {
  if (name.kind === 'all') return t('reading.rangeAll');
  if (name.kind === 'scene') return sceneTitle({ title: name.scene_title, no: name.scene_no }, t);
  return t('reading.rangeLines', { start: name.start, end: name.end });
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

/** 앱은 늘 읽어주기·녹음·말이 끝나면 넘김으로 시작한다(암기 대조·마이크 없는 진행은 앱에 없다). */
export function buildStartBody(input: {
  requestId: string;
  myCharacterIds: string[];
  startLineId: string;
  endLineId: string;
}): StartSessionBody {
  return {
    request_id: input.requestId,
    my_character_ids: input.myCharacterIds,
    mode: 'read',
    start_line_id: input.startLineId,
    end_line_id: input.endLineId,
    advance: 'silence',
    record: true,
  };
}

/** 이 줄 수 이하이면 대사가 거의 없는 배역이다 — 안내를 띄우고 다음 회차 기본값으로 다시 고르지 않는다(SOMA-709). */
export const FEW_LINES_MAX = 2;

/** 함께 말하는 줄의 묶음 배역(「지해, 연수」 — 서버가 member_ids 를 준다). 내 배역 칩에 두지 않는다(SOMA-709). */
export function isGroupCharacter(character: { member_ids?: string[] }): boolean {
  return (character.member_ids?.length ?? 0) > 0;
}

/**
 * 리딩에서 내 차례로 읽는 배역 이름 — 고른 배역과, 고른 배역이 들어 있는 함께 말하는 줄의 묶음 배역(SOMA-709·785).
 * 들어 있지 않은 묶음 배역의 줄은 상대역이 읽는다.
 */
export function turnRoles(characters: Pick<ScriptCharacter, 'id' | 'name' | 'member_ids'>[], myIds: string[]): string[] {
  return characters.filter((c) => myIds.includes(c.id) || (c.member_ids ?? []).some((id) => myIds.includes(id))).map((c) => c.name);
}

/** 리딩 화면의 이름표. 묶음 배역은 「함께 · 윤서·태오」처럼 멤버 이름을 잇는다. 모르는 이름은 그대로. */
export function roleLabel(characters: Pick<ScriptCharacter, 'id' | 'name' | 'member_ids'>[], role: string, together: string): string {
  const group = characters.find((c) => c.name === role && isGroupCharacter(c));
  if (!group) return role;
  const names = group.member_ids!.map((id) => characters.find((c) => c.id === id)?.name).filter(Boolean);
  return `${together} · ${names.join('·')}`;
}

/**
 * 배역 칩의 대사 수 — 서버 값이 있으면 그것, 없으면 대본 줄에서 센다. 서버처럼 그 배역이 든 함께 말하는 줄(묶음 배역)도
 * 센다({@link turnRoles}). characters 를 주지 않으면 그 배역 이름의 줄만 센다.
 */
export function roleLineCount(
  character: { id?: string; name: string; dialogue_count?: number },
  lines: ScriptLine[],
  characters?: Pick<ScriptCharacter, 'id' | 'name' | 'member_ids'>[],
): number {
  if (character.dialogue_count !== undefined && character.dialogue_count !== null) return character.dialogue_count;
  const roles = new Set(characters && character.id !== undefined ? [character.name, ...turnRoles(characters, [character.id])] : [character.name]);
  return lines.filter((l) => l.type === 'dialogue' && roles.has(l.role)).length;
}

/** 고른 배역(여럿이면 합쳐서)의 구간 안 대사가 1~{@link FEW_LINES_MAX}줄이면 그 수. 0줄은 시작할 때 empty_range 로 막으므로 null. */
export function fewLines(lines: ScriptLine[], myRoles: string[], start: number, end: number): number | null {
  const mine = new Set(myRoles);
  let count = 0;
  for (let i = Math.max(0, start); i <= end && i < lines.length; i++) {
    const l = lines[i];
    if (l.type === 'dialogue' && mine.has(l.role)) count++;
  }
  return count > 0 && count <= FEW_LINES_MAX ? count : null;
}

/**
 * 내 배역의 처음 선택. 회차 상세 「이 구간으로 다시 연습」이 넘긴 배역(쉼표로 이은 id)이 있으면 그것이고, 없으면
 * 마지막 회차의 내 배역이다. 회차가 없으면 아무것도 골라 두지 않는다. 배역이 하나뿐인 대본은 그 배역이다.
 * 칩에 없는 묶음 배역은 고르지 않고, 지난 회차의 배역은 대본에 남아 있고 대본 전체 대사가 {@link FEW_LINES_MAX}줄보다 많은 것만
 * 다시 고른다 — 실수로 고른 배역이 회차마다 이어지지 않게(SOMA-709). 대사 수를 모르는 옛 응답이면 대사 수로 거르지 않는다.
 */
export function defaultMyCharacterIds(script: {
  last_session: { my_character_ids: string[] } | null;
  characters: { id: string; dialogue_count?: number; member_ids?: string[] }[];
  rolesParam?: string;
}): string[] {
  const people = script.characters.filter((c) => !isGroupCharacter(c));
  const known = new Map(people.map((c) => [c.id, c] as const));
  const fromParam = (script.rolesParam ?? '').split(',').filter((id) => known.has(id));
  if (fromParam.length) return fromParam;
  if (people.length === 1) return [people[0].id];
  return (script.last_session?.my_character_ids ?? []).filter((id) => {
    const count = known.get(id)?.dialogue_count;
    return known.has(id) && (count === undefined || count > FEW_LINES_MAX);
  });
}

export type LineRange = { startIndex: number; endIndex: number };

/** 대사 번호 구간(1부터, 양끝 포함) → 줄 인덱스. 대본에 없는 번호면 null. */
export function rangeOfDialogueNos(lines: ScriptLine[], startNo: number, endNo: number): LineRange | null {
  const numbers = dialogueNumbers(lines);
  const startIndex = numbers.indexOf(startNo);
  const endIndex = numbers.indexOf(endNo);
  return startIndex < 0 || endIndex < startIndex ? null : { startIndex, endIndex };
}

/** 회차 상세가 넘긴 시작·끝 줄 id → 줄 인덱스. 없거나 뒤집혀 있으면 null. */
export function rangeOfLineIds(lineIds: string[], startId: string | undefined, endId: string | undefined): LineRange | null {
  const startIndex = startId ? lineIds.indexOf(startId) : -1;
  const endIndex = endId ? lineIds.indexOf(endId) : -1;
  return startIndex < 0 || endIndex < startIndex ? null : { startIndex, endIndex };
}

/** 「최근 구간」 — 같은 구간은 가장 최근 회차 하나만, 최근에 시작한 순. 줄마다 그 회차의 회차 번호·날짜를 보인다. */
export function recentRanges<T extends Pick<SessionCard, 'range' | 'started_at'>>(sessions: T[]): T[] {
  const seen = new Set<string>();
  return [...sessions]
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
    .filter((s) => {
      const key = `${s.range.start_dialogue_no}-${s.range.end_dialogue_no}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * 시작 버튼 상태. 내 배역이 없으면 고르라 하고, 녹음은 늘 하므로 마이크 권한이 없으면 시작하지 못한다.
 * 권한·최근 구간을 아직 모르면 잠깐 꺼 둔다(기본 구간이 바뀌기 전에 시작하지 않게).
 */
export type StartGate = 'pickRole' | 'needMic' | 'wait' | 'ready';

export function startGate(input: { roleCount: number; micGranted: boolean | null; loading: boolean }): StartGate {
  if (input.roleCount === 0) return 'pickRole';
  if (input.micGranted === false) return 'needMic';
  if (input.micGranted === null || input.loading) return 'wait';
  return 'ready';
}
