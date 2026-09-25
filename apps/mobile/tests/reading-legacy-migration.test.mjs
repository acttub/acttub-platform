import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError, NetworkError } from '../lib/api-request.ts';
import { parseScript } from '../lib/reading/parse.ts';
import {
  LEGACY_MIGRATION_KEY,
  LEGACY_SCRIPTS_KEY,
  dismissLegacyNotice,
  migrateLegacyScripts,
  readLegacyNotice,
  rebuildRawText,
} from '../lib/reading/legacy-migration.ts';

// ─── 옛 앱(1.0.0 이전)이 기기에 남긴 대본 ─────────────────────────────────────

const OLD_ONE = {
  id: 's_1',
  title: '옥상, 밤',
  roles: ['윤서', '태오'],
  lines: [
    { type: 'direction', text: '옥상 난간. 바람 소리.' },
    { type: 'dialogue', role: '윤서', text: '여기 있을 줄 알았어.' },
    { type: 'dialogue', role: '태오', text: '어떻게 알았어.' },
    { type: 'dialogue', role: '윤서', text: '너 힘들면 항상 높은 데로 가잖아.' },
    { type: 'dialogue', role: '태오', text: '그런가.' },
  ],
  myRoles: ['윤서'],
  index: 2,
  status: 'reading',
  dialogueCount: 4,
  startIndex: 0,
  endIndex: 4,
  maskMode: 'none',
  memorized: [1, 3, 4],
  recordings: [{ id: 'r_1', uri: 'file:///cache/Audio/recording-1.m4a', durationSec: 30, coveredCount: 2, totalCount: 4, createdAt: 1 }],
  createdAt: 1,
  updatedAt: 2,
};
const OLD_TWO = {
  id: 's_2',
  title: '제목 없는 대본',
  roles: ['지수', '민준'],
  lines: [
    { type: 'dialogue', role: '지수', text: '오래 기다렸어?' },
    { type: 'dialogue', role: '민준', text: '아니, 나도 방금 왔어.' },
    { type: 'dialogue', role: '지수', text: '다행이다.' },
    { type: 'dialogue', role: '민준', text: '응.' },
  ],
  myRoles: [],
  index: 0,
  status: 'draft',
  dialogueCount: 4,
  startIndex: 0,
  endIndex: 3,
  maskMode: 'none',
  memorized: [],
  recordings: [],
  createdAt: 3,
  updatedAt: 4,
};

/** 옛 대본을 가진 폰과 리딩 API 흉내. */
function phone({ scripts = [OLD_ONE, OLD_TWO], limitAfter = Infinity, networkDown = false, memorizationFails = false } = {}) {
  const items = new Map([[LEGACY_SCRIPTS_KEY, JSON.stringify(scripts)]]);
  const disk = new Set(scripts.flatMap((s) => s.recordings.map((r) => r.uri)));
  const server = { scripts: new Map(), byRequest: new Map(), memorization: [], posts: [] };
  let seq = 0;
  const deps = {
    storage: {
      getItem: async (k) => items.get(k) ?? null,
      setItem: async (k, v) => void items.set(k, v),
      removeItem: async (k) => void items.delete(k),
    },
    createScript: async (body) => {
      server.posts.push(body);
      if (networkDown) throw new NetworkError();
      const existing = server.byRequest.get(body.request_id);
      if (existing) return existing;
      if (server.scripts.size >= limitAfter) throw new ApiError(422, 'script_limit', 'script_limit', 'script_limit');
      const id = `sc_${++seq}`;
      const detail = {
        id,
        title: body.title,
        source: body.source,
        characters: body.characters.map((c, i) => ({ id: `${id}_c${i}`, name: c.name, order: i, voice_preset: null, dialogue_count: 0 })),
        lines: body.lines.map((l, i) => ({
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
      };
      server.scripts.set(id, { body, detail });
      server.byRequest.set(body.request_id, detail);
      return detail;
    },
    setMemorization: async (lineId, status) => {
      if (memorizationFails) throw new NetworkError();
      server.memorization.push({ lineId, status });
      return { line_id: lineId, status, updated_at: 'now' };
    },
    deleteFile: async (uri) => void disk.delete(uri),
    newRequestId: () => `rid-${server.posts.length + 1}-${Math.random().toString(36).slice(2, 6)}`,
    now: () => 1_000,
  };
  return { items, disk, server, deps, remaining: () => JSON.parse(items.get(LEGACY_SCRIPTS_KEY) ?? '[]') };
}

test('reading.script: 옛 대본의 원문은 줄에서 "이름: 대사" 꼴로 되살리고, 다시 나누면 같은 배역·줄이 나온다', () => {
  const raw = rebuildRawText(OLD_ONE);
  assert.equal(
    raw,
    `옥상, 밤

(옥상 난간. 바람 소리.)
윤서: 여기 있을 줄 알았어.
태오: 어떻게 알았어.
윤서: 너 힘들면 항상 높은 데로 가잖아.
태오: 그런가.`,
  );
  const again = parseScript(raw);
  assert.equal(again.title, '옥상, 밤');
  assert.deepEqual(again.roles, OLD_ONE.roles);
  assert.deepEqual(again.lines, OLD_ONE.lines);
});

test('reading.script: 옛 대본 둘(하나에 외운 줄 셋)과 녹음 하나가 있는 기기 — 서버에 대본 둘(paste), 외운 줄 셋이 memorized, 기기의 대본·녹음 파일이 없다', async () => {
  const { items, disk, server, deps, remaining } = phone();

  const result = await migrateLegacyScripts(deps);

  assert.deepEqual(result, { moved: 2, memorized: 3, limited: 0, failed: 0 });
  assert.equal(server.scripts.size, 2);
  for (const { body } of server.scripts.values()) {
    assert.equal(body.source, 'paste');
    assert.ok(body.raw_text.length > 0);
    assert.match(body.request_id, /^rid-/);
  }
  const [first] = [...server.scripts.values()];
  assert.equal(first.body.title, '옥상, 밤');
  assert.deepEqual(first.body.characters, [{ name: '윤서' }, { name: '태오' }]);
  // memorized 줄 번호(1, 3, 4)가 새 줄 id에 대응된다
  assert.deepEqual(
    server.memorization,
    [1, 3, 4].map((i) => ({ lineId: `${first.detail.id}_l${i + 1}`, status: 'memorized' })),
  );
  assert.deepEqual(remaining(), []);
  assert.equal(items.has(LEGACY_SCRIPTS_KEY), false, '다 옮기면 옛 저장소 키가 없다');
  assert.equal(disk.size, 0, '옛 녹음 파일은 올리지 않고 지운다');
  assert.deepEqual(await readLegacyNotice(deps.storage), { moved: 2, memorized: 3, limited: 0, failed: 0, at: 1_000 });
});

test('reading.script: 옛 대본 둘 중 하나가 한도에 걸림 — 성공한 대본만 기기에서 지워지고 걸린 대본은 남아 다음 실행에 다시 시도한다', async () => {
  const { server, deps, remaining } = phone({ limitAfter: 1 });

  const first = await migrateLegacyScripts(deps);
  assert.deepEqual(first, { moved: 1, memorized: 3, limited: 1, failed: 0 });
  assert.deepEqual(remaining().map((s) => s.id), ['s_2']);
  const limitedRequestId = server.posts[1].request_id;

  // 대본을 정리해 자리가 생긴 뒤 다음 실행
  server.scripts.clear();
  const second = await migrateLegacyScripts(deps);
  assert.deepEqual(second, { moved: 1, memorized: 0, limited: 0, failed: 0 });
  assert.equal(server.posts[2].request_id, limitedRequestId, '재시도는 같은 요청 id를 쓴다');
  assert.deepEqual(remaining(), []);
});

test('reading.script: 연결이 끊기면 아무것도 지우지 않고, 다음 실행에 같은 요청 id로 다시 보낸다', async () => {
  const p = phone({ networkDown: true });

  const first = await migrateLegacyScripts(p.deps);
  assert.deepEqual(first, { moved: 0, memorized: 0, limited: 0, failed: 2 });
  assert.deepEqual(p.remaining().map((s) => s.id), ['s_1', 's_2']);
  assert.equal(p.server.posts.length, 1, '첫 대본에서 연결이 끊기면 나머지는 다음 실행으로 미룬다');
  const requestId = p.server.posts[0].request_id;

  // 다음 실행 — 연결이 돌아왔다. 저장소(옛 대본·요청 id 장부)는 그대로다.
  const q = phone();
  q.items.set(LEGACY_SCRIPTS_KEY, p.items.get(LEGACY_SCRIPTS_KEY));
  q.items.set(LEGACY_MIGRATION_KEY, p.items.get(LEGACY_MIGRATION_KEY));
  const second = await migrateLegacyScripts(q.deps);
  assert.deepEqual(second, { moved: 2, memorized: 3, limited: 0, failed: 0 });
  assert.equal(q.server.posts[0].request_id, requestId, '같은 요청 id');
  assert.equal(q.server.scripts.size, 2);
});

test('reading.script: 같은 요청 id·같은 본문으로 두 번 보내도 서버 대본은 하나이고 두 응답의 대본 id가 같다', async () => {
  const { server, deps } = phone({ scripts: [OLD_ONE], memorizationFails: true });

  const first = await migrateLegacyScripts(deps);
  assert.deepEqual(first, { moved: 0, memorized: 0, limited: 0, failed: 1 }, '암기 저장이 실패하면 대본은 기기에 남긴다');
  assert.equal(server.scripts.size, 1);

  deps.setMemorization = async (lineId, status) => {
    server.memorization.push({ lineId, status });
    return { line_id: lineId, status, updated_at: 'now' };
  };
  const second = await migrateLegacyScripts(deps);
  assert.deepEqual(second, { moved: 1, memorized: 3, limited: 0, failed: 0 });
  assert.equal(server.scripts.size, 1, '행 하나');
  assert.equal(server.posts[0].request_id, server.posts[1].request_id);
  assert.equal(server.posts.length, 2);
});

test('reading.script: 옛 대본이 없으면 아무 요청도 보내지 않는다', async () => {
  const { server, deps } = phone({ scripts: [] });
  assert.deepEqual(await migrateLegacyScripts(deps), { moved: 0, memorized: 0, limited: 0, failed: 0 });
  assert.equal(server.posts.length, 0);
  assert.equal(await readLegacyNotice(deps.storage), null);
});

test('reading.script: 옮기기 안내는 한 번 보여 준 뒤 닫을 수 있다', async () => {
  const { deps } = phone();
  await migrateLegacyScripts(deps);
  assert.ok(await readLegacyNotice(deps.storage));
  await dismissLegacyNotice(deps.storage);
  assert.equal(await readLegacyNotice(deps.storage), null);
});
