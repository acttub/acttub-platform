import assert from 'node:assert/strict';
import test from 'node:test';

import {
  configureScriptTransport,
  deleteScript,
  getCurrent,
  isMyRole,
  loadIntoCurrent,
  resetReadingState,
  toSavedScript,
  updateCurrent,
  updateScriptMeta,
} from '../lib/reading/store.ts';

/** 서버가 나눠 저장한 대본의 줄(저장 본문 모양). */
const BODY = {
  title: '옥상, 밤',
  source: 'paste',
  characters: [{ name: '윤서' }, { name: '태오' }],
  lines: [
    { ordinal: 1, kind: 'scene', character_index: null, text: '제1막' },
    { ordinal: 2, kind: 'dialogue', character_index: 0, text: '여기 있을 줄 알았어.' },
    { ordinal: 3, kind: 'dialogue', character_index: 1, text: '어떻게 알았어.' },
    { ordinal: 4, kind: 'direction', character_index: null, text: '사이' },
    { ordinal: 5, kind: 'dialogue', character_index: 0, text: '너 힘들면 항상 높은 데로 가잖아.' },
    { ordinal: 6, kind: 'dialogue', character_index: 1, text: '그런가.' },
  ],
};

/** 새 대본은 목소리가 모두 자동이라 서버 voice 는 배역 순서대로 이 순환이다. */
const VOICES = ['F1', 'M1', 'F2', 'M2', 'F3', 'M3', 'F4', 'M4', 'F5', 'M5'];

/** 서버 scenes 모양. 이 테스트들은 장면 경계를 보지 않아 첫·마지막 대사를 잇는 장면 하나로 둔다. */
function oneScene(lines, id) {
  const dialogues = lines.filter((l) => l.kind === 'dialogue');
  if (!dialogues.length) return [];
  const lineId = (l) => `${id}_l${l.ordinal}`;
  return [{ no: 1, title: null, start_line_id: lineId(dialogues[0]), end_line_id: lineId(dialogues.at(-1)), dialogue_count: dialogues.length }];
}

/** 리딩 API 흉내. seed 는 서버 나누기가 저장을 마친 대본 하나를 넣는다. */
function fakeServer() {
  const state = { scripts: new Map(), calls: [] };
  let seq = 0;
  const detailOf = (body, id) => ({
    id,
    title: body.title,
    source: body.source,
    characters: body.characters.map((c, i) => ({ id: `${id}_c${i}`, name: c.name, order: i, voice_preset: null, voice: VOICES[i % VOICES.length], dialogue_count: 0 })),
    lines: body.lines.map((l) => ({
      id: `${id}_l${l.ordinal}`,
      ordinal: l.ordinal,
      kind: l.kind,
      character_id: l.character_index === null ? null : `${id}_c${l.character_index}`,
      text: l.text,
      dialogue_no: null,
    })),
    scenes: oneScene(body.lines, id),
    recording_count: 0,
    open_session_id: null,
    last_session: null,
    created_at: 'now',
    updated_at: 'now',
  });
  const transport = {
    list: async (q) => {
      state.calls.push(['list', q]);
      const scripts = [...state.scripts.values()].map((d) => ({
        id: d.id, title: d.title, my_character_names: [], dialogue_count: 0, recording_count: 0, last_activity_at: null, status: 'no_cast', updated_at: 'now',
      }));
      return { scripts, total_count: scripts.length, in_progress_count: 0 };
    },
    get: async (id) => {
      state.calls.push(['get', id]);
      const d = state.scripts.get(id);
      if (!d) throw new Error('404');
      return d;
    },
    patch: async (id, body) => {
      state.calls.push(['patch', id, body]);
      const d = state.scripts.get(id);
      const next = {
        ...d,
        title: body.title ?? d.title,
        characters: d.characters.map((c) => {
          const change = (body.characters ?? []).find((x) => x.id === c.id);
          return change?.name !== undefined ? { ...c, name: change.name } : c;
        }),
      };
      state.scripts.set(id, next);
      return next;
    },
    remove: async (id) => {
      state.calls.push(['delete', id]);
      state.scripts.delete(id);
    },
  };
  const seed = () => {
    const detail = detailOf(BODY, `sc_${++seq}`);
    state.scripts.set(detail.id, detail);
    return detail;
  };
  return { state, transport, seed };
}

test.beforeEach(() => {
  resetReadingState();
  configureScriptTransport(null);
});

test('reading.script: 서버 상세를 화면 모양으로 — 줄은 배역 이름으로, 지문·장면은 배역 없이', async () => {
  const { transport, seed } = fakeServer();
  configureScriptTransport(transport);
  const saved = await loadIntoCurrent(seed().id);

  assert.deepEqual(saved.roles, ['윤서', '태오']);
  assert.deepEqual(saved.lines[0], { type: 'scene', text: '제1막' });
  assert.deepEqual(saved.lines[1], { type: 'dialogue', role: '윤서', text: '여기 있을 줄 알았어.' });
  assert.deepEqual(saved.lines[3], { type: 'direction', text: '사이' });
  assert.equal(saved.dialogueCount, 4);
  assert.equal(saved.lineIds.length, 6);
  assert.equal(saved.characters[1].name, '태오');
});

test('reading.script: 제목·배역 이름 수정은 제목과 배역(id·이름)만 보내고 줄은 보내지 않는다', async () => {
  const { state, transport, seed } = fakeServer();
  configureScriptTransport(transport);
  const saved = await loadIntoCurrent(seed().id);

  const updated = await updateScriptMeta(saved.id, { title: '옥상', characters: [{ id: saved.characters[1].id, name: '태오(형)' }] });

  const [, id, body] = state.calls.find(([kind]) => kind === 'patch');
  assert.equal(id, saved.id);
  assert.deepEqual(body, { title: '옥상', characters: [{ id: saved.characters[1].id, name: '태오(형)' }] });
  assert.ok(!('lines' in body));
  assert.equal(updated.title, '옥상');
  assert.equal(getCurrent()?.title, '옥상', '현재 대본에도 반영된다');
  assert.deepEqual(getCurrent()?.roles, ['윤서', '태오(형)']);
  assert.equal(getCurrent()?.lines[2].role, '태오(형)', '줄의 배역 연결은 그대로고 이름만 바뀐다');
});

test('reading.script: 대본을 지우면 서버에 삭제를 보내고 현재 대본을 비운다', async () => {
  const { state, transport, seed } = fakeServer();
  configureScriptTransport(transport);
  const saved = await loadIntoCurrent(seed().id);

  await deleteScript(saved.id);

  assert.deepEqual(state.calls.at(-1), ['delete', saved.id]);
  assert.equal(state.scripts.size, 0);
  assert.equal(getCurrent(), null);
});

test('reading.script: 목록에서 연 대본은 서버 상세로 현재 대본이 되고 내 배역 판정이 된다', async () => {
  const { transport, seed } = fakeServer();
  configureScriptTransport(transport);
  const saved = seed();
  assert.equal(getCurrent(), null);

  const opened = await loadIntoCurrent(saved.id);
  assert.equal(opened?.id, saved.id);
  await updateCurrent({ myRoles: ['윤서'] });
  assert.equal(isMyRole('윤서'), true);
  assert.equal(isMyRole('태오'), false);
});

test('reading.script: toSavedScript 는 기기 설정(가리기·내 배역)을 덮어 쓴다', () => {
  const detail = {
    id: 'sc_9', title: 'x', source: 'file',
    characters: [{ id: 'c0', name: '윤서', order: 0, voice_preset: null, voice: 'F1', dialogue_count: 1 }],
    lines: [{ id: 'l1', ordinal: 1, kind: 'dialogue', character_id: 'c0', text: '안녕', dialogue_no: 1 }],
    scenes: [{ no: 1, title: null, start_line_id: 'l1', end_line_id: 'l1', dialogue_count: 1 }],
    recording_count: 2, open_session_id: null, last_session: null, created_at: 'a', updated_at: 'b',
  };
  const s = toSavedScript(detail, { maskMode: 'mine', myRoles: ['윤서'] });
  assert.equal(s.maskMode, 'mine');
  assert.deepEqual(s.myRoles, ['윤서']);
  assert.equal(s.recordingCount, 2);
  assert.deepEqual(s.scenes, [{ no: 1, title: null, start_line_id: 'l1', end_line_id: 'l1', dialogue_count: 1 }]);
  assert.equal(toSavedScript(detail).maskMode, 'none');
});
