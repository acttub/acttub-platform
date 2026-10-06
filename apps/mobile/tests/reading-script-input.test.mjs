import assert from 'node:assert/strict';
import test from 'node:test';

import { SAMPLE_SCRIPT } from '../lib/reading/sample.ts';
import {
  formatFileSize,
  initialScriptInput,
  pendingScript,
  scriptInputReducer,
  showsSampleLink,
} from '../lib/reading/script-input.ts';

const run = (state, ...actions) => actions.reduce(scriptInputReducer, state);
const PASTED = '윤서: 여기 있을 줄 알았어.\n태오: 어떻게 알았어.\n윤서: 너 힘들면 항상 높은 데로 가잖아.';

test('reading.script(R2): 처음엔 파일 탭이고 보낼 것이 없어 [다음]이 꺼진다. 예시 링크는 보인다', () => {
  const state = initialScriptInput(false);
  assert.equal(state.tab, 'file');
  assert.equal(pendingScript(state), null);
  assert.equal(showsSampleLink(state), true);
});

test('reading.script(R2): 파일은 서버가 다 읽어야 보낼 수 있고, [다음]은 올려 둔 upload_id 를 보낸다', () => {
  const reading = run(initialScriptInput(false), { type: 'fileReading', name: '갈매기 3막.pdf', size: 1_258_291 });
  assert.equal(pendingScript(reading), null, '읽는 중에는 [다음]이 꺼진다');
  const ready = run(reading, { type: 'fileRead', uploadId: 'up-1' });
  assert.deepEqual(pendingScript(ready), { kind: 'file', uploadId: 'up-1' });
  assert.deepEqual(ready.file, { kind: 'ready', name: '갈매기 3막.pdf', size: 1_258_291, uploadId: 'up-1' });
  assert.equal(ready.paste.text, '');
});

test('reading.script(R2): 탭마다 내용을 따로 들고 [다음]은 보고 있는 탭의 것을 보낸다', () => {
  const both = run(
    initialScriptInput(false),
    { type: 'fileReading', name: 'a.txt', size: 2048 },
    { type: 'fileRead', uploadId: 'up-1' },
    { type: 'tab', tab: 'paste' },
    { type: 'paste', text: PASTED },
  );
  assert.deepEqual(pendingScript(both), { kind: 'text', text: PASTED, source: 'paste' }, '한 번에 길게 들어오면 붙여넣기');
  assert.deepEqual(pendingScript(run(both, { type: 'tab', tab: 'file' })), { kind: 'file', uploadId: 'up-1' });
  assert.deepEqual(pendingScript(run(initialScriptInput(false), { type: 'tab', tab: 'paste' }, { type: 'paste', text: '윤' })), {
    kind: 'text',
    text: '윤',
    source: 'typed',
  });
  assert.equal(pendingScript(run(initialScriptInput(false), { type: 'tab', tab: 'paste' }, { type: 'paste', text: '  \n ' })), null);
});

test('reading.script(R2): 예시 링크는 아무것도 넣지 않은 빈 상태에만 — 누르면 글 탭에 예시가 채워진다', () => {
  const sample = run(initialScriptInput(false), { type: 'sample' });
  assert.equal(sample.tab, 'paste');
  assert.deepEqual(pendingScript(sample), { kind: 'text', text: SAMPLE_SCRIPT.trim(), source: 'sample' });
  assert.equal(showsSampleLink(sample), false);
  assert.deepEqual(initialScriptInput(true), sample, '튜토리얼 예시로 들어오면 처음부터 같은 상태');

  const failed = run(initialScriptInput(false), { type: 'fileReading', name: 'big.pdf', size: 30_000_000 }, { type: 'fileFailed' });
  assert.equal(failed.file.kind, 'empty');
  assert.equal(showsSampleLink(failed), false, '파일 읽기에 실패해도 한 번 넣었으면 숨긴다');
  assert.equal(showsSampleLink(run(initialScriptInput(false), { type: 'tab', tab: 'paste' })), true, '빈 글 탭에도 보인다');
});

test('reading.script(R2): 파일 크기는 1MB 아래면 KB, 넘으면 소수 한 자리 MB', () => {
  assert.equal(formatFileSize(500), '1KB');
  assert.equal(formatFileSize(300 * 1024), '300KB');
  assert.equal(formatFileSize(1_258_291), '1.2MB');
});
