import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCRIPT_FILE_MAX_BYTES,
  checkScriptFile,
  nextTextSource,
  scriptFileKind,
} from '../lib/reading/file-input.ts';

test('reading.script: 20,000,001바이트 파일은 글자를 뽑지 않고 거른다', () => {
  assert.equal(SCRIPT_FILE_MAX_BYTES, 20_000_000);
  assert.deepEqual(checkScriptFile({ name: 'a.txt', mimeType: 'text/plain', size: 20_000_001 }), { ok: false, reason: 'too_large' });
  assert.deepEqual(checkScriptFile({ name: 'a.txt', mimeType: 'text/plain', size: 20_000_000 }), { ok: true, kind: 'txt' });
});

test('reading.script: 앱에서 hwp·hwpx를 고르면 미지원 안내다', () => {
  assert.deepEqual(checkScriptFile({ name: '대본.hwp', mimeType: 'application/octet-stream', size: 10 }), { ok: false, reason: 'hwp' });
  assert.deepEqual(checkScriptFile({ name: '대본.HWPX', mimeType: undefined, size: 10 }), { ok: false, reason: 'hwp' });
  assert.deepEqual(checkScriptFile({ name: '대본.xyz', mimeType: undefined, size: 10 }), { ok: false, reason: 'unsupported' });
});

test('reading.script: txt·pdf·docx를 알아본다(확장자 또는 MIME)', () => {
  assert.equal(scriptFileKind({ name: 'a.pdf' }), 'pdf');
  assert.equal(scriptFileKind({ name: 'a', mimeType: 'application/pdf' }), 'pdf');
  assert.equal(scriptFileKind({ name: 'a.docx' }), 'docx');
  assert.equal(scriptFileKind({ name: 'a', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'docx');
  assert.equal(scriptFileKind({ name: 'a.txt' }), 'txt');
  assert.equal(scriptFileKind({ name: 'a.hwp' }), 'hwp');
});

test('reading.script: 입력 경로 — 한 번에 많이 들어오면 붙여넣기, 조금씩이면 직접 쓰기, 파일·예시는 그대로 남는다', () => {
  assert.equal(nextTextSource(null, '', '윤'), 'typed');
  assert.equal(nextTextSource('typed', '윤', '윤서'), 'typed');
  const pasted = '윤서: 여기 있을 줄 알았어.\n태오: 어떻게 알았어.\n윤서: 너 힘들면 항상 높은 데로 가잖아.';
  assert.ok(pasted.length >= 30);
  assert.equal(nextTextSource('typed', '윤서', pasted), 'paste');
  assert.equal(nextTextSource('paste', '긴 글', '긴 글.'), 'paste', '붙여넣은 뒤 손본 것은 여전히 붙여넣기다');
  assert.equal(nextTextSource('file', '파일 글', '파일 글 고침'), 'file');
  assert.equal(nextTextSource('sample', '예시', '예시 고침'), 'sample');
  assert.equal(nextTextSource('paste', '긴 글', ''), null, '다 지우면 처음으로');
});
