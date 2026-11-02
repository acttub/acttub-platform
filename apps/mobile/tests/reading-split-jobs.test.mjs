import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '../lib/api-request.ts';
import { addSplitJob, checkSplitJob, readSplitJobs, removeSplitJob, splitJobTitle, SPLIT_JOBS_KEY } from '../lib/reading/split-jobs.ts';

function fakeStorage(initial) {
  const items = new Map(initial === undefined ? [] : [[SPLIT_JOBS_KEY, initial]]);
  return { items, getItem: async (key) => items.get(key) ?? null, setItem: async (key, value) => void items.set(key, value) };
}

const job = (over) => ({ id: 'i1', status: 'running', progress: { done_lines: 0, total_lines: 0 }, script_id: null, failure: null, ...over });

test('기록은 앞에 쌓이고 같은 작업은 하나로 두며 지울 수 있다', async () => {
  const storage = fakeStorage();
  await addSplitJob({ importId: 'a', title: '가' }, storage);
  await addSplitJob({ importId: 'b', title: '나' }, storage);
  await addSplitJob({ importId: 'a', title: '가' }, storage);
  assert.deepEqual((await readSplitJobs(storage)).map((one) => one.importId), ['a', 'b']);
  await removeSplitJob('a', storage);
  assert.deepEqual(await readSplitJobs(storage), [{ importId: 'b', title: '나' }]);
});

test('접수와 지우기를 기다리지 않고 잇따라 불러도 차례대로 쓴다', async () => {
  const storage = fakeStorage();
  await Promise.all([addSplitJob({ importId: 'a', title: '' }, storage), addSplitJob({ importId: 'b', title: '' }, storage), removeSplitJob('a', storage)]);
  assert.deepEqual((await readSplitJobs(storage)).map((one) => one.importId), ['b']);
});

test('깨졌거나 못 읽는 기록은 없는 것으로 보고, 쓰기 실패는 나누기로 번지지 않는다', async () => {
  assert.deepEqual(await readSplitJobs(fakeStorage('{깨짐')), []);
  assert.deepEqual(await readSplitJobs(fakeStorage('{"a":1}')), []);
  const broken = { getItem: async () => { throw new Error('disk'); }, setItem: async () => { throw new Error('disk'); } };
  assert.deepEqual(await readSplitJobs(broken), []);
  await addSplitJob({ importId: 'a', title: '' }, broken);
  // 실패 뒤의 쓰기도 막히지 않는다.
  const storage = fakeStorage();
  await addSplitJob({ importId: 'b', title: '' }, storage);
  assert.equal((await readSplitJobs(storage)).length, 1);
});

test('제목은 적은 제목, 파일 이름 순이고 붙여넣은 글은 비운다', () => {
  const file = { kind: 'file', file: { uri: 'file:///a', name: '버스정류장_대본.hwp', size: 1 }, uploadId: 'u' };
  const text = { kind: 'text', text: '글', source: 'paste' };
  assert.equal(splitJobTitle(file, ' 내 제목 '), '내 제목');
  assert.equal(splitJobTitle(file, '  '), '버스정류장 대본');
  assert.equal(splitJobTitle(text), '');
});

test('진행률은 percent 를 쓰고 없는 옛 서버면 줄 수로 센다', async () => {
  const percent = await checkSplitJob('i1', async () => job({ progress: { done_lines: 10, total_lines: 10, percent: 62 } }));
  assert.deepEqual(percent, { kind: 'running', pct: 62 });
  const lines = await checkSplitJob('i1', async () => job({ status: 'pending', progress: { done_lines: 1, total_lines: 4 } }));
  assert.deepEqual(lines, { kind: 'running', pct: 25 });
});

test('끝난 작업과 없는 작업, 다시 물을 오류를 가른다', async () => {
  assert.deepEqual(await checkSplitJob('i1', async () => job({ status: 'succeeded', script_id: 's1' })), { kind: 'succeeded' });
  assert.deepEqual(await checkSplitJob('i1', async () => job({ status: 'failed', failure: 'not_script' })), { kind: 'failed' });
  const fail = (error) => async () => { throw error; };
  assert.deepEqual(await checkSplitJob('i1', fail(new ApiError(404, '없음', 'import_not_found'))), { kind: 'gone' });
  assert.deepEqual(await checkSplitJob('i1', fail(new ApiError(429, '한도'))), { kind: 'unknown' });
  assert.deepEqual(await checkSplitJob('i1', fail(new Error('끊김'))), { kind: 'unknown' });
});
