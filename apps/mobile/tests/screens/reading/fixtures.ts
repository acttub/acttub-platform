import { fireEvent, screen } from '@testing-library/react-native';

import { configureScriptTransport, openScript, resetReadingState, type ScriptTransport } from '@/lib/reading/store';
import type { ScriptCharacter, ScriptDetail, ScriptLineRecord, SessionCard, SessionDetail } from '@/lib/reading/types';

type LineSeed = [kind: 'dialogue', character: string, text: string] | [kind: 'direction' | 'scene', text: string];

const NAMES = ['민재', '서연', '지호'];

/** 화면 테스트용 대본 상세. 줄 id 는 l1·l2…, 배역 id 는 c1·c2… 다. */
export function scriptDetail(lines: LineSeed[], over: Partial<ScriptDetail> = {}): ScriptDetail {
  const names = [...new Set(lines.filter((l) => l[0] === 'dialogue').map((l) => l[1]))];
  const characters: ScriptCharacter[] = names.map((name, i) => ({
    id: `c${NAMES.indexOf(name) + 1 || i + 1}`,
    name,
    order: i,
    voice_preset: null,
    voice: i % 2 ? 'F1' : 'M1',
    dialogue_count: lines.filter((l) => l[0] === 'dialogue' && l[1] === name).length,
  }));
  const idOf = new Map(characters.map((c) => [c.name, c.id]));
  let dialogueNo = 0;
  const records: ScriptLineRecord[] = lines.map((l, i) => ({
    id: `l${i + 1}`,
    ordinal: i + 1,
    kind: l[0],
    character_id: l[0] === 'dialogue' ? idOf.get(l[1])! : null,
    text: l[0] === 'dialogue' ? l[2] : l[1],
    dialogue_no: l[0] === 'dialogue' ? ++dialogueNo : null,
  }));
  return {
    id: 's1',
    title: '봄날의 대화',
    source: 'paste',
    characters,
    lines: records,
    scenes: [],
    recording_count: 0,
    open_session_id: null,
    last_session: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...over,
  };
}

export const TWO_ROLE_LINES: LineSeed[] = [
  ['scene', '1장 카페'],
  ['dialogue', '민재', '오늘 왔구나.'],
  ['direction', '서연이 자리에 앉는다.'],
  ['dialogue', '서연', '응, 늦어서 미안해.'],
  ['dialogue', '민재', '괜찮아.'],
];

export function sessionCard(over: Partial<SessionCard> = {}): SessionCard {
  return {
    id: 'r1',
    ordinal: 1,
    status: 'in_progress',
    my_character_ids: ['c1'],
    my_character_names: ['민재'],
    range: { start_dialogue_no: 1, end_dialogue_no: 3 },
    range_name: { kind: 'all', scene_no: null, scene_title: null, start: 1, end: 3 },
    progress: { done: 1, total: 3 },
    my_dialogue_count: 2,
    recorded_line_count: 0,
    elapsed_seconds: 65,
    started_at: '2026-10-19T10:00:00Z',
    ended_at: null,
    ...over,
  };
}

export function sessionDetail(over: Partial<SessionDetail> = {}): SessionDetail {
  return {
    ...sessionCard(),
    script_id: 's1',
    mode: 'read',
    start_line_id: 'l2',
    end_line_id: 'l5',
    advance: 'manual',
    record: false,
    current_line_id: 'l2',
    progress_seq: 0,
    recordings: [],
    different_lines: [],
    ...over,
  };
}

/** 가짜 서버. 각 메서드는 jest.fn 이라 테스트가 응답을 바꾸고 받은 인자를 본다. */
export function fakeServer(detail: ScriptDetail) {
  const server = {
    list: jest.fn(async () => ({ scripts: [], total_count: 0, in_progress_count: 0 })),
    get: jest.fn(async () => detail),
    patch: jest.fn(async () => detail),
    patchLine: jest.fn(async () => detail),
    deleteLine: jest.fn(async () => detail),
    splitLine: jest.fn(async () => detail),
    insertLineAfter: jest.fn(async () => detail),
    remove: jest.fn(async () => undefined),
    startSession: jest.fn(async () => sessionDetail()),
    getSession: jest.fn(async () => sessionDetail()),
    saveProgress: jest.fn(async () => ({
      current_line_id: null,
      elapsed_seconds: 0,
      progress_seq: 1,
      status: 'in_progress' as const,
      different_lines: [],
    })),
    listSessions: jest.fn(async () => ({ sessions: [] as SessionCard[] })),
    deleteSession: jest.fn(async () => undefined),
  } satisfies ScriptTransport;
  configureScriptTransport(server);
  return server;
}

/** 가짜 서버를 끼우고 대본을 현재 대본으로 올린다. */
export async function openFixtureScript(detail: ScriptDetail = scriptDetail(TWO_ROLE_LINES)) {
  resetReadingState();
  const server = fakeServer(detail);
  const script = await openScript(detail);
  return { server, script };
}

/** 글자를 품은 Modal 에 뒤로 가기(onRequestClose)를 보낸다. requestClose 는 버블링되지 않아 Modal 에 직접 쏜다. */
export async function closeModalOf(text: string) {
  let node: { type: string; parent: unknown } | null = screen.getByText(text) as never;
  while (node && node.type !== 'Modal') node = node.parent as typeof node;
  if (!node) throw new Error(`"${text}" 를 품은 Modal 이 없다`);
  await fireEvent(node as never, 'requestClose');
}
