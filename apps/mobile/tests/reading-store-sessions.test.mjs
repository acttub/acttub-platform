import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { beforeEach, test } from 'node:test';

// store 는 무설치 node 에서도 읽히도록 AsyncStorage·api 를 함수 안에서 require 한다. 앱(Metro)의 require 자리를
// 전역 require 로 채워 기기 저장소와 리딩 API 를 기억 속 가짜로 바꾼다. 대본 삭제 뒤의 합성 음성 정리도 가짜로 받는다.
globalThis.__storeTest = { removedSpeech: [] };
const t = globalThis.__storeTest;
const storage = new Map();
const failing = { get: false, set: false };
const apiCalls = [];
const replies = {};
globalThis.require = (id) => {
  if (id === '@react-native-async-storage/async-storage') {
    return {
      default: {
        getItem: async (key) => {
          if (failing.get) throw new Error('storage locked');
          return storage.get(key) ?? null;
        },
        setItem: async (key, value) => {
          if (failing.set) throw new Error('disk full');
          storage.set(key, value);
        },
      },
    };
  }
  if (id === '../api') {
    return {
      api: new Proxy({}, {
        get: (_target, name) => async (...args) => {
          apiCalls.push([name, ...args]);
          const reply = replies[name];
          if (reply instanceof Error) throw reply;
          return typeof reply === 'function' ? reply(...args) : reply;
        },
      }),
    };
  }
  throw new Error(`unexpected require: ${id}`);
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '../account-files' && context.parentURL?.endsWith('/reading/store.ts')) {
      const source = `export async function deleteSpeechFilesOfScript(id) {
        if (globalThis.__storeTest.speechFails) throw new Error('fs');
        globalThis.__storeTest.removedSpeech.push(id);
      }`;
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const store = await import('../lib/reading/store.ts');

const PREFS_KEY = 'acttub.reading.devicePrefs';

function detail(over = {}) {
  return {
    id: 's1',
    title: '봄날의 대화',
    source: 'paste',
    characters: [
      { id: 'c2', name: '서연', order: 1, voice_preset: null, voice: 'F1', dialogue_count: 1 },
      { id: 'c1', name: '민재', order: 0, voice_preset: null, voice: 'M1', dialogue_count: 2 },
    ],
    lines: [
      { id: 'l3', ordinal: 3, kind: 'dialogue', character_id: 'c1', text: '괜찮아.', dialogue_no: 3 },
      { id: 'l1', ordinal: 1, kind: 'dialogue', character_id: 'c1', text: '오늘 왔구나.', dialogue_no: 1 },
      { id: 'l2', ordinal: 2, kind: 'dialogue', character_id: 'c2', text: '응.', dialogue_no: 2 },
      { id: 'l4', ordinal: 4, kind: 'direction', character_id: null, text: '퇴장' },
      { id: 'l5', ordinal: 5, kind: 'dialogue', character_id: 'gone', text: '누구?', dialogue_no: 4 },
    ],
    scenes: [],
    recording_count: 2,
    open_session_id: null,
    last_session: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...over,
  };
}

function session(over = {}) {
  return { id: 'r1', script_id: 's1', my_character_ids: ['c2'], progress_seq: 0, recordings: [], different_lines: [], ...over };
}

beforeEach(() => {
  store.configureScriptTransport(null);
  store.resetReadingState();
  storage.clear();
  failing.get = false;
  failing.set = false;
  apiCalls.length = 0;
  for (const key of Object.keys(replies)) delete replies[key];
  t.removedSpeech.length = 0;
  t.speechFails = false;
});

test('가짜 서버를 넣지 않으면 대본·회차 요청을 리딩 API 로 보낸다', async () => {
  Object.assign(replies, {
    listReadingScripts: { scripts: [], total_count: 0, in_progress_count: 0 },
    getReadingScript: () => detail(),
    updateReadingScript: () => detail({ title: '새 제목' }),
    updateReadingScriptLine: () => detail(),
    startReadingSession: () => session(),
    getReadingSession: () => session(),
    saveReadingProgress: { progress_seq: 1 },
    listReadingSessions: { sessions: [{ id: 'r1' }] },
  });

  await store.listScripts('  봄 ');
  await store.listScripts('   ');
  await store.loadIntoCurrent('s1');
  await store.updateScriptMeta('s1', { title: '새 제목' });
  await store.editScriptLine('s1', 'l2', { text: '응!' });
  await store.startSession('s1', { request_id: 'q1' });
  await store.fetchSession('r1');
  await store.saveProgress('r1', { progress_seq: 1 });
  assert.deepEqual(await store.listSessions('s1'), [{ id: 'r1' }]);
  await store.deleteSession('r1');
  await store.deleteScript('s1');

  assert.deepEqual(apiCalls, [
    ['listReadingScripts', '봄'],
    ['listReadingScripts', undefined],
    ['getReadingScript', 's1'],
    ['updateReadingScript', 's1', { title: '새 제목' }],
    ['updateReadingScriptLine', 's1', 'l2', { text: '응!' }],
    ['startReadingSession', 's1', { request_id: 'q1' }],
    ['getReadingSession', 'r1'],
    ['saveReadingProgress', 'r1', { progress_seq: 1 }],
    ['listReadingSessions', 's1'],
    ['deleteReadingSession', 'r1'],
    ['deleteReadingScript', 's1'],
  ]);
});

test('서버 상세를 배역·줄 순서대로 풀어 현재 대본으로 올리고, 배역을 모르는 대사는 이름을 비운다', async () => {
  replies.getReadingScript = () => detail();
  const script = await store.loadIntoCurrent('s1');

  assert.deepEqual(script.roles, ['민재', '서연']);
  assert.deepEqual(script.lineIds, ['l1', 'l2', 'l3', 'l4', 'l5']);
  assert.deepEqual(script.lines.map((l) => (l.type === 'dialogue' ? l.role : l.type)), ['민재', '서연', '민재', 'direction', '']);
  assert.equal(script.dialogueCount, 4);
  assert.equal(script.recordingCount, 2);
  assert.equal(script.lastSession, null);
  assert.equal(store.getCurrent(), script);
});

test('대사 보기·내 배역은 기기에 대본마다 남고, 대본을 다시 열면 얹는다', async () => {
  replies.getReadingScript = () => detail();
  await store.loadIntoCurrent('s1');
  await store.updateCurrent({ maskMode: 'all', myRoles: ['서연'] });

  assert.deepEqual(JSON.parse(storage.get(PREFS_KEY)), { s1: { maskMode: 'all', myRoles: ['서연'] } });
  assert.equal(store.isMyRole('서연'), true);
  store.resetReadingState();
  assert.equal(store.isMyRole('서연'), false);

  const reopened = await store.loadIntoCurrent('s1');
  assert.equal(reopened.maskMode, 'all');
  assert.deepEqual(reopened.myRoles, ['서연']);
});

test('현재 대본이 없으면 기기 설정을 바꾸지 않는다', async () => {
  await store.updateCurrent({ maskMode: 'mine' });

  assert.equal(store.getCurrent(), null);
  assert.equal(storage.has(PREFS_KEY), false);
});

test('기기 설정이 깨졌거나 저장소를 못 쓰면 기본값으로 연다', async () => {
  replies.getReadingScript = () => detail();
  for (const raw of ['{broken', '["s1"]', 'null']) {
    storage.set(PREFS_KEY, raw);
    const script = await store.loadIntoCurrent('s1');
    assert.equal(script.maskMode, 'none');
    assert.deepEqual(script.myRoles, []);
  }

  failing.get = true;
  assert.equal((await store.loadIntoCurrent('s1')).maskMode, 'none');
  failing.get = false;
  failing.set = true;
  await store.updateCurrent({ maskMode: 'all' });
  assert.equal(store.getCurrent().maskMode, 'all');
});

test('불러오지 못한 대본이 현재 대본이면 비우고, 다른 대본이면 그대로 둔다', async () => {
  replies.getReadingScript = () => detail();
  await store.loadIntoCurrent('s1');

  replies.getReadingScript = new Error('404');
  assert.equal(await store.loadIntoCurrent('other'), null);
  assert.equal(store.getCurrent()?.id, 's1');
  assert.equal(await store.loadIntoCurrent('s1'), null);
  assert.equal(store.getCurrent(), null);
});

test('제목·배역 고치기는 준 항목만 보내고, 목소리는 키가 있을 때만 보내며 null 은 자동이다', async () => {
  replies.getReadingScript = () => detail();
  replies.updateReadingScript = () => detail({ title: '여름' });
  await store.loadIntoCurrent('s1');

  await store.updateScriptMeta('s1', { characters: [{ id: 'c1', name: '민재2' }, { id: 'c2', voice_preset: null }, { id: 'c3', voice_preset: 'M5' }] });
  await store.updateScriptMeta('other', { title: '남의 것' });

  assert.deepEqual(apiCalls.slice(1).map(([, id, body]) => [id, body]), [
    ['s1', { characters: [{ id: 'c1', name: '민재2' }, { id: 'c2', voice_preset: null }, { id: 'c3', voice_preset: 'M5' }] }],
    ['other', { title: '남의 것' }],
  ]);
  assert.equal(store.getCurrent().title, '여름');
});

test('줄 고치기는 바꾼 항목만 보내고, 다른 대본이면 현재 대본을 건드리지 않는다', async () => {
  replies.getReadingScript = () => detail();
  replies.updateReadingScriptLine = () => detail({ title: '고친 뒤' });
  await store.loadIntoCurrent('s1');

  await store.editScriptLine('s1', 'l2', { kind: 'dialogue', characterId: 'c1' });
  assert.equal(store.getCurrent().title, '고친 뒤');
  replies.updateReadingScriptLine = () => detail({ title: '남의 대본' });
  await store.editScriptLine('s9', 'l1', { kind: 'scene' });

  assert.deepEqual(apiCalls.slice(1).map(([, , , body]) => body), [{ kind: 'dialogue', character_id: 'c1' }, { kind: 'scene' }]);
  assert.equal(store.getCurrent().title, '고친 뒤');
});

test('대본을 지우면 현재 대본과 기기 설정을 비우고 합성 음성도 지운다', async () => {
  replies.getReadingScript = () => detail();
  await store.loadIntoCurrent('s1');
  await store.updateCurrent({ maskMode: 'mine' });

  await store.deleteScript('s1');
  assert.equal(store.getCurrent(), null);
  assert.deepEqual(JSON.parse(storage.get(PREFS_KEY)), {});
  assert.deepEqual(t.removedSpeech, ['s1']);
});

test('다른 대본을 지우면 현재 대본은 그대로이고, 합성 음성 정리가 실패해도 삭제는 끝난다', async () => {
  replies.getReadingScript = () => detail();
  await store.loadIntoCurrent('s1');
  t.speechFails = true;

  await store.deleteScript('s2');
  assert.equal(store.getCurrent()?.id, 's1');
  assert.deepEqual(t.removedSpeech, []);
});

test('회차를 시작하면 현재 회차가 되고, 현재 대본의 내 배역을 회차 배역으로 맞춘다', async () => {
  replies.getReadingScript = () => detail();
  replies.startReadingSession = () => session({ my_character_ids: ['c2', 'c1'] });
  await store.loadIntoCurrent('s1');

  const started = await store.startSession('s1', { request_id: 'q1' });
  assert.equal(store.getCurrentSession(), started);
  assert.deepEqual(store.getCurrent().myRoles, ['민재', '서연']);

  replies.startReadingSession = () => session({ id: 'r2', my_character_ids: ['c1'] });
  await store.startSession('s9', { request_id: 'q2' });
  assert.equal(store.getCurrentSession().id, 'r2');
  assert.deepEqual(store.getCurrent().myRoles, ['민재', '서연']);
});

test('회차를 못 읽으면 null 이고, 지운 회차가 현재 회차면 비운다', async () => {
  replies.getReadingSession = new Error('404');
  assert.equal(await store.fetchSession('r1'), null);

  store.setCurrentSession(session());
  await store.deleteSession('r9');
  assert.equal(store.getCurrentSession().id, 'r1');
  await store.deleteSession('r1');
  assert.equal(store.getCurrentSession(), null);
});

test('완료 화면의 비교 결과를 다르게 말한 대사 화면에 넘기고, 초기화하면 지운다', () => {
  const review = { sessionId: 'r1', startIndex: 0, endIndex: 3, myRoles: ['민재'], different: [] };
  store.setLastRunReview(review);
  assert.equal(store.getLastRunReview(), review);

  store.resetReadingState();
  assert.equal(store.getLastRunReview(), null);
});

test('옛 저장소의 녹음 파일 주소만 골라내고, 깨진 값은 빈 목록이다', () => {
  assert.deepEqual(store.recordingFileUris(null), []);
  assert.deepEqual(store.recordingFileUris('{broken'), []);
  assert.deepEqual(store.recordingFileUris('{"recordings":[]}'), []);
  assert.deepEqual(
    store.recordingFileUris(JSON.stringify([
      { recordings: [{ uri: 'file:///a.m4a' }, null, { uri: '' }, { uri: 3 }, {}] },
      { recordings: 'none' },
      null,
      { recordings: [{ uri: 'file:///b.m4a' }] },
    ])),
    ['file:///a.m4a', 'file:///b.m4a'],
  );
});
