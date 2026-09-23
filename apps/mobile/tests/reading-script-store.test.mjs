import assert from 'node:assert/strict';
import test from 'node:test';

import { NetworkError } from '../lib/api-request.ts';
import {
  configureScriptTransport,
  deleteScript,
  getCurrent,
  isMyRole,
  loadIntoCurrent,
  newDraft,
  resetReadingState,
  saveDraft,
  toSavedScript,
  updateCurrent,
  updateScriptMeta,
} from '../lib/reading/store.ts';

const RAW = `윤서: 여기 있을 줄 알았어.
태오: 어떻게 알았어.
(사이)
윤서: 너 힘들면 항상 높은 데로 가잖아.
태오: 그런가.`;

/** 리딩 API 흉내. request_id 로 멱등하고, 처음 몇 번은 연결이 끊긴다. */
function fakeServer({ failFirst = 0 } = {}) {
  const state = { scripts: new Map(), byRequest: new Map(), calls: [], failures: failFirst };
  let seq = 0;
  const detailOf = (body, id) => ({
    id,
    title: body.title,
    source: body.source,
    characters: body.characters.map((c, i) => ({ id: `${id}_c${i}`, name: c.name, order: i, voice_preset: null, dialogue_count: 0 })),
    lines: body.lines.map((l) => ({
      id: `${id}_l${l.ordinal}`,
      ordinal: l.ordinal,
      kind: l.kind,
      character_id: l.character_index === null ? null : `${id}_c${l.character_index}`,
      text: l.text,
      dialogue_no: null,
    })),
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
    create: async (body) => {
      state.calls.push(['create', body]);
      if (state.failures > 0) {
        state.failures -= 1;
        throw new NetworkError();
      }
      const existing = state.byRequest.get(body.request_id);
      if (existing) return existing;
      const detail = detailOf(body, `sc_${++seq}`);
      state.scripts.set(detail.id, detail);
      state.byRequest.set(body.request_id, detail);
      return detail;
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
  return { state, transport };
}

test.beforeEach(() => {
  resetReadingState();
  configureScriptTransport(null);
});

test('reading.script: 저장 도중 연결이 끊기면 같은 요청 id로 다시 보내고 서버 대본은 하나다', async () => {
  const { state, transport } = fakeServer({ failFirst: 1 });
  configureScriptTransport(transport);
  const draft = newDraft(RAW, 'paste');

  await assert.rejects(saveDraft(draft), NetworkError);
  const saved = await saveDraft(draft);
  const again = await saveDraft(draft);

  const creates = state.calls.filter(([kind]) => kind === 'create').map(([, body]) => body);
  assert.equal(creates.length, 3);
  assert.ok(creates.every((b) => b.request_id === draft.requestId), '같은 요청 id');
  assert.match(draft.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(state.scripts.size, 1, '행 하나');
  assert.equal(saved.id, again.id, '두 응답의 대본 id가 같다');
  assert.equal(getCurrent()?.id, saved.id, '저장한 대본이 현재 대본이 된다');
});

test('reading.script: 배역 없는 초안은 서버에 보내지 않고 no_characters 로 막는다', async () => {
  const { state, transport } = fakeServer();
  configureScriptTransport(transport);
  await assert.rejects(saveDraft(newDraft('그냥 산문.\n배역 없음.', 'typed')), /no_characters/);
  assert.equal(state.calls.length, 0);
});

test('reading.script: 저장 응답을 화면 모양으로 — 줄은 배역 이름으로, 지문·장면은 배역 없이', async () => {
  const { transport } = fakeServer();
  configureScriptTransport(transport);
  const saved = await saveDraft(newDraft(`제1막\n${RAW}`, 'paste'));

  assert.deepEqual(saved.roles, ['윤서', '태오']);
  assert.deepEqual(saved.lines[0], { type: 'scene', text: '제1막' });
  assert.deepEqual(saved.lines[1], { type: 'dialogue', role: '윤서', text: '여기 있을 줄 알았어.' });
  assert.deepEqual(saved.lines[3], { type: 'direction', text: '사이' });
  assert.equal(saved.dialogueCount, 4);
  assert.equal(saved.lineIds.length, 6);
  assert.equal(saved.characters[1].name, '태오');
  assert.equal(saved.source, 'paste');
});

test('reading.script: 제목·배역 이름 수정은 제목과 배역(id·이름)만 보내고 줄은 보내지 않는다', async () => {
  const { state, transport } = fakeServer();
  configureScriptTransport(transport);
  const saved = await saveDraft(newDraft(RAW, 'paste'));

  const updated = await updateScriptMeta(saved.id, { title: '옥상', characters: [{ id: saved.characters[1].id, name: '태오(형)' }] });

  const [, id, body] = state.calls.find(([kind]) => kind === 'patch');
  assert.equal(id, saved.id);
  assert.deepEqual(body, { title: '옥상', characters: [{ id: saved.characters[1].id, name: '태오(형)' }] });
  assert.ok(!('lines' in body));
  assert.equal(updated.title, '옥상');
  assert.equal(getCurrent()?.title, '옥상', '현재 대본에도 반영된다');
  assert.deepEqual(getCurrent()?.roles, ['윤서', '태오(형)']);
  assert.equal(getCurrent()?.lines[1].role, '태오(형)', '줄의 배역 연결은 그대로고 이름만 바뀐다');
});

test('reading.script: 대본을 지우면 서버에 삭제를 보내고 현재 대본을 비운다', async () => {
  const { state, transport } = fakeServer();
  configureScriptTransport(transport);
  const saved = await saveDraft(newDraft(RAW, 'paste'));

  await deleteScript(saved.id);

  assert.deepEqual(state.calls.at(-1), ['delete', saved.id]);
  assert.equal(state.scripts.size, 0);
  assert.equal(getCurrent(), null);
});

test('reading.script: 목록에서 연 대본은 서버 상세로 현재 대본이 되고 내 배역 판정이 된다', async () => {
  const { transport } = fakeServer();
  configureScriptTransport(transport);
  const saved = await saveDraft(newDraft(RAW, 'paste'));
  resetReadingState();
  assert.equal(getCurrent(), null);

  const opened = await loadIntoCurrent(saved.id);
  assert.equal(opened?.id, saved.id);
  await updateCurrent({ myRoles: ['윤서'] });
  assert.equal(isMyRole('윤서'), true);
  assert.equal(isMyRole('태오'), false);
});

test('reading.script: toSavedScript 는 기기 설정(가리기·내 배역·위치)을 덮어 쓴다', () => {
  const detail = {
    id: 'sc_9', title: 'x', source: 'file',
    characters: [{ id: 'c0', name: '윤서', order: 0, voice_preset: null, dialogue_count: 1 }],
    lines: [{ id: 'l1', ordinal: 1, kind: 'dialogue', character_id: 'c0', text: '안녕', dialogue_no: 1 }],
    recording_count: 2, open_session_id: null, last_session: null, created_at: 'a', updated_at: 'b',
  };
  const s = toSavedScript(detail, { maskMode: 'mine', myRoles: ['윤서'], index: 0, startIndex: 0, endIndex: 0, status: 'reading' });
  assert.equal(s.maskMode, 'mine');
  assert.deepEqual(s.myRoles, ['윤서']);
  assert.equal(s.recordingCount, 2);
  assert.equal(toSavedScript(detail).maskMode, 'none');
});
