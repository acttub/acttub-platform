import assert from 'node:assert/strict';
import test from 'node:test';

import { SAMPLE_SCRIPT } from '../lib/reading/sample.ts';
import {
  formatFileSize,
  initialScriptInput,
  pendingScript,
  scriptInputReducer,
  titleFromFileName,
} from '../lib/reading/script-input.ts';

const run = (state, ...actions) => actions.reduce(scriptInputReducer, state);
const A_TXT = { uri: 'file:///a.txt', name: 'a.txt', size: 2048 };
const PASTED = '윤서: 여기 있을 줄 알았어.\n태오: 어떻게 알았어.\n윤서: 너 힘들면 항상 높은 데로 가잖아.';

test('reading.script(R2): 처음엔 파일 탭이고 보낼 것이 없어 [다음]이 꺼진다', () => {
  const state = initialScriptInput(false);
  assert.equal(state.tab, 'file');
  assert.equal(pendingScript(state), null);
});

test('reading.script(R2): 파일 이름으로 제목을 채운다 — 확장자를 떼고 밑줄은 띄어쓰기', () => {
  const cases = [
    ['버스정류장_대본.txt', '버스정류장 대본'],
    ['갈매기 3막.pdf', '갈매기 3막'],
    ['Scene_1__final.v2.DOCX', 'Scene 1 final.v2'],
    ['_옥상_밤_.hwp', '옥상 밤'],
    ['확장자없음_대본', '확장자없음 대본'],
    ['.hwp', ''],
  ];
  for (const [name, title] of cases) assert.equal(titleFromFileName(name), title, name);
});

test('reading.script(R2): 파일을 고르면 파일 탭 제목이 채워지고, 고친 제목은 그 탭에만 남는다', () => {
  const picked = run(initialScriptInput(false), { type: 'fileReading', file: { uri: 'file:///b.txt', name: '버스정류장_대본.txt', size: 900 } });
  assert.deepEqual(picked.title, { file: '버스정류장 대본', paste: '' });
  const edited = run(picked, { type: 'title', title: '정류장' }, { type: 'tab', tab: 'paste' }, { type: 'title', title: '옥상' });
  assert.deepEqual(edited.title, { file: '정류장', paste: '옥상' });
});

test('reading.script(R2): 파일은 서버가 다 읽어야 보낼 수 있고, [다음]은 올려 둔 upload_id 를 보낸다', () => {
  const file = { uri: 'file:///갈매기.pdf', name: '갈매기 3막.pdf', size: 1_258_291 };
  const reading = run(initialScriptInput(false), { type: 'fileReading', file });
  assert.equal(pendingScript(reading), null, '읽는 중에는 [다음]이 꺼진다');
  const ready = run(reading, { type: 'fileUploaded', uploadId: 'up-1' });
  assert.deepEqual(pendingScript(ready), { kind: 'file', file, uploadId: 'up-1' });
  assert.deepEqual(pendingScript(run(ready, { type: 'fileUploaded', uploadId: 'up-2' })), { kind: 'file', file, uploadId: 'up-2' }, '다시 올리면 새 upload_id');
  assert.equal(ready.paste.text, '');
});

test('reading.script(R2): 탭마다 내용을 따로 들고 [다음]은 보고 있는 탭의 것을 보낸다', () => {
  const both = run(
    initialScriptInput(false),
    { type: 'fileReading', file: A_TXT },
    { type: 'fileUploaded', uploadId: 'up-1' },
    { type: 'tab', tab: 'paste' },
    { type: 'paste', text: PASTED },
  );
  assert.deepEqual(pendingScript(both), { kind: 'text', text: PASTED, source: 'paste' }, '한 번에 길게 들어오면 붙여넣기');
  assert.deepEqual(pendingScript(run(both, { type: 'tab', tab: 'file' })), { kind: 'file', file: A_TXT, uploadId: 'up-1' });
  assert.deepEqual(pendingScript(run(initialScriptInput(false), { type: 'tab', tab: 'paste' }, { type: 'paste', text: '윤' })), {
    kind: 'text',
    text: '윤',
    source: 'typed',
  });
  assert.equal(pendingScript(run(initialScriptInput(false), { type: 'tab', tab: 'paste' }, { type: 'paste', text: '  \n ' })), null);
});

test('reading.script(R2): 예시를 고르면 글 탭에 예시가 채워진다', () => {
  const sample = run(initialScriptInput(false), { type: 'sample' });
  assert.equal(sample.tab, 'paste');
  assert.deepEqual(pendingScript(sample), { kind: 'text', text: SAMPLE_SCRIPT.trim(), source: 'sample' });
  assert.deepEqual(initialScriptInput(true), sample, '튜토리얼 예시로 들어오면 처음부터 같은 상태');

  const failed = run(initialScriptInput(false), { type: 'fileReading', file: { uri: 'file:///big.pdf', name: 'big.pdf', size: 30_000_000 } }, { type: 'fileFailed' });
  assert.equal(failed.file.kind, 'empty');
});

test('reading.script(R2): 파일 크기는 1MB 아래면 KB, 넘으면 소수 한 자리 MB', () => {
  assert.equal(formatFileSize(500), '1KB');
  assert.equal(formatFileSize(300 * 1024), '300KB');
  assert.equal(formatFileSize(1_258_291), '1.2MB');
});

test('reading.script(R2): 파일을 올리는 동안에는 글 탭에 글이 있어도 [다음]이 꺼진다 — 올리기 결과 팝업이 나누는 중 팝업을 덮지 않게', () => {
  const uploading = run(
    initialScriptInput(false),
    { type: 'fileReading', file: A_TXT },
    { type: 'tab', tab: 'paste' },
    { type: 'paste', text: PASTED },
  );
  assert.equal(pendingScript(uploading), null);
  assert.deepEqual(pendingScript(run(uploading, { type: 'fileUploaded', uploadId: 'up-1' })), { kind: 'text', text: PASTED, source: 'paste' });
});
