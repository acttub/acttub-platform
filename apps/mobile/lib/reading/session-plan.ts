/**
 * 새 연습(R8, reading.cast · reading.session)의 순수 계산 — 대사 번호, 구간 이름의 글, 구간 당기기, 최근 구간,
 * 내 배역 기본값, 시작 가능 여부, 기기 사전 검사, 시작 요청 본문. 장면 나누기·구간 이름은 서버가 정한다. 화면·서버를 모른다.
 */
import type { RangeName, ScriptLine, SessionCard, StartSessionBody } from './types.ts';

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

/**
 * 내 배역의 처음 선택. 회차 상세 「이 구간으로 다시 연습」이 넘긴 배역(쉼표로 이은 id)이 있으면 그것이고, 없으면
 * 마지막 회차의 내 배역이다. 회차가 없으면 아무것도 골라 두지 않는다. 배역이 하나뿐인 대본은 그 배역이다.
 */
export function defaultMyCharacterIds(script: {
  last_session: { my_character_ids: string[] } | null;
  characters: { id: string }[];
  rolesParam?: string;
}): string[] {
  const known = new Set(script.characters.map((c) => c.id));
  const fromParam = (script.rolesParam ?? '').split(',').filter((id) => known.has(id));
  if (fromParam.length) return fromParam;
  if (script.characters.length === 1) return [script.characters[0].id];
  return (script.last_session?.my_character_ids ?? []).filter((id) => known.has(id));
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
