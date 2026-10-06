import assert from 'node:assert/strict';
import test from 'node:test';

import { isScriptFileTooLarge, nextTextSource } from '../lib/reading/file-input.ts';

test('reading.script: 50,000,000바이트를 넘는 파일만 올리기 전에 거른다', () => {
  assert.equal(isScriptFileTooLarge(50_000_001), true);
  assert.equal(isScriptFileTooLarge(50_000_000), false);
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
