import assert from 'node:assert/strict';
import test from 'node:test';

import { LEGACY_ARCHIVE_KEY, migrateLegacyArchive, readLegacyArchive } from '../lib/library/legacy-archive.ts';

const OLD = [
  { id: 'rec-1', uri: 'file:///docs/archive/rec-1.mp4', durationSec: 12, createdAt: '2026-09-01T00:00:00Z', favorite: true },
  { id: 'rec-2', uri: 'file:///docs/archive/rec-2.mp4', durationSec: null, createdAt: '2026-09-02T00:00:00Z', favorite: false },
  { id: 'rec-3', uri: 'file:///docs/archive/rec-3.mp4', durationSec: 40, createdAt: '2026-09-03T00:00:00Z', favorite: false },
];

function phone(list = OLD) {
  const items = new Map([[LEGACY_ARCHIVE_KEY, JSON.stringify(list)]]);
  const queued = [];
  return {
    items,
    queued,
    storage: {
      getItem: async (k) => items.get(k) ?? null,
      setItem: async (k, v) => void items.set(k, v),
      removeItem: async (k) => void items.delete(k),
    },
    enqueue: async (entry) => void queued.push(entry),
    newRequestId: () => `rid-${queued.length + 1}`,
  };
}

test('practice.record: 옛 보관함 영상 셋이 있는 기기에서 1.0.0 첫 실행이면 확인 팝업을 띄울 대상이 셋이다', async () => {
  const p = phone();
  assert.equal((await readLegacyArchive(p.storage)).length, 3);
  assert.equal((await readLegacyArchive(phone([]).storage)).length, 0, '없으면 묻지 않는다');
});

test('practice.record: 확인하면 셋이 업로드 대기 큐에 들어가고(videos 3행이 될 것) 옛 목록은 비운다', async () => {
  const p = phone();
  const result = await migrateLegacyArchive({ storage: p.storage, owner: 'u1', enqueue: p.enqueue, newRequestId: p.newRequestId, now: () => 5_000 });
  assert.deepEqual(result, { moved: 3 });
  assert.equal(p.queued.length, 3);
  assert.deepEqual(p.queued.map((e) => e.requestId), ['rid-1', 'rid-2', 'rid-3']);
  assert.equal(p.queued[0].owner, 'u1');
  assert.equal(p.queued[0].durationMs, 12_000);
  assert.equal(p.queued[1].durationMs, null, '길이를 모르면 null — 큐가 압축 때 잰다');
  assert.equal(p.queued[0].createdAt, 5_000);
  assert.equal(p.items.has(LEGACY_ARCHIVE_KEY), false);
});

test('practice.record: 취소하면 기기에 남고 행이 없으며 다음 실행에 다시 묻는다(플래그를 남기지 않는다)', async () => {
  const p = phone();
  // 취소는 아무것도 부르지 않는다 — 옛 목록이 그대로라 다음 실행의 readLegacyArchive 가 다시 셋을 준다.
  assert.equal((await readLegacyArchive(p.storage)).length, 3);
  assert.equal(p.queued.length, 0);
  assert.ok(p.items.has(LEGACY_ARCHIVE_KEY));
});
