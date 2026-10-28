import assert from 'node:assert/strict';
import test from 'node:test';

import { loadExampleUrl } from '../lib/challenge/example-pick.ts';

const NOW = Date.parse('2026-10-28T12:00:00+09:00');
const card = (id, over = {}) => ({ id, origin: 'team', entry_count: 5, ends_at: '2026-10-25T00:00:00+09:00', ...over });
const entry = (rank, url) => ({ rank, playback_url: url });
const lister = (map) => async (id) => {
  if (map[id] instanceof Error) throw map[id];
  return { entries: map[id] ?? [], next_cursor: null, ranking_state: null };
};

test('지난주 선정작(3위 안)의 재생 주소를 쓴다', async () => {
  const url = await loadExampleUrl({
    ended: [card('last')], featuredId: 'now', now: NOW,
    listEntries: lister({ last: [entry(1, null), entry(2, 'L2'), entry(5, 'L5')], now: [entry(null, 'N1')] }),
  });
  assert.equal(url, 'L2');
});

test('선정작이 없거나 주소가 없으면 이번 주 좋아요 순 첫 재생 가능 참여작', async () => {
  const run = (last) => loadExampleUrl({ ended: [card('last')], featuredId: 'now', now: NOW, listEntries: lister({ last, now: [entry(null, null), entry(null, 'N2')] }) });
  assert.equal(await run([entry(null, 'X'), entry(4, 'Y')]), 'N2');
  assert.equal(await run([entry(1, null)]), 'N2');
});

test('지난주 조회가 실패하거나 지난주 챌린지가 없으면 이번 주로 넘어간다', async () => {
  const now = [entry(null, 'N1')];
  assert.equal(await loadExampleUrl({ ended: [card('last')], featuredId: 'now', now: NOW, listEntries: lister({ last: new Error('x'), now }) }), 'N1');
  assert.equal(await loadExampleUrl({ ended: [], featuredId: 'now', now: NOW, listEntries: lister({ now }) }), 'N1');
  assert.equal(await loadExampleUrl({ ended: [card('old', { ends_at: '2026-10-01T00:00:00+09:00' })], featuredId: 'now', now: NOW, listEntries: lister({ old: [entry(1, 'O')], now }) }), 'N1');
});

test('후보가 전혀 없으면 null', async () => {
  assert.equal(await loadExampleUrl({ ended: [], featuredId: null, listEntries: lister({}) }), null);
  assert.equal(await loadExampleUrl({ ended: [], featuredId: 'now', listEntries: lister({ now: [entry(null, null)] }) }), null);
});
