import assert from 'node:assert/strict';
import test from 'node:test';

import { parseInline, parseMarkdown } from '../lib/markdown.ts';

test('F5: 굵게·기울임·코드·링크를 스팬으로 쪼갠다', () => {
  assert.deepEqual(parseInline('의도가 **안 닿았어요**'), [
    { text: '의도가 ' },
    { text: '안 닿았어요', bold: true },
  ]);
  assert.deepEqual(parseInline('*조금* 더'), [{ text: '조금', italic: true }, { text: ' 더' }]);
  assert.deepEqual(parseInline('`code` 확인'), [
    { text: 'code', code: true },
    { text: ' 확인' },
  ]);
  assert.deepEqual(parseInline('[약관](https://acttub.com/terms)'), [
    { text: '약관', href: 'https://acttub.com/terms' },
  ]);
});

test('F5: 마크업이 없으면 통짜 텍스트 스팬 하나다', () => {
  assert.deepEqual(parseInline('그냥 문장'), [{ text: '그냥 문장' }]);
});

test('F5: 제목은 레벨과 함께 heading 블록이 된다', () => {
  assert.deepEqual(parseMarkdown('# 이용약관\n## 제1조\n### 목적'), [
    { type: 'heading', level: 1, spans: [{ text: '이용약관' }] },
    { type: 'heading', level: 2, spans: [{ text: '제1조' }] },
    { type: 'heading', level: 3, spans: [{ text: '목적' }] },
  ]);
});

test('F5: 연속된 - 줄은 하나의 목록으로 묶인다', () => {
  assert.deepEqual(parseMarkdown('- 첫째\n- 둘째'), [
    {
      type: 'list',
      ordered: false,
      items: [[{ text: '첫째' }], [{ text: '둘째' }]],
    },
  ]);
});

test('F5: 1. 로 시작하면 순서 있는 목록이다', () => {
  assert.deepEqual(parseMarkdown('1. 하나\n2. 둘'), [
    {
      type: 'list',
      ordered: true,
      items: [[{ text: '하나' }], [{ text: '둘' }]],
    },
  ]);
});

test('F5: 빈 줄로 나뉜 문단은 각각의 블록이고, 이어진 줄은 한 문단으로 합쳐진다', () => {
  assert.deepEqual(parseMarkdown('첫 문단\n이어지는 줄\n\n두 번째 문단'), [
    { type: 'paragraph', spans: [{ text: '첫 문단 이어지는 줄' }] },
    { type: 'paragraph', spans: [{ text: '두 번째 문단' }] },
  ]);
});

test('F5: 인용과 구분선을 알아본다', () => {
  assert.deepEqual(parseMarkdown('> 인용문\n\n---'), [
    { type: 'quote', spans: [{ text: '인용문' }] },
    { type: 'rule' },
  ]);
});

test('F5: 목록 다음에 오는 문단은 목록에 흡수되지 않는다', () => {
  assert.deepEqual(parseMarkdown('- 항목\n일반 문장'), [
    { type: 'list', ordered: false, items: [[{ text: '항목' }]] },
    { type: 'paragraph', spans: [{ text: '일반 문장' }] },
  ]);
});

test('F5: 실제 동의 문서 형태를 통째로 파싱한다', () => {
  const doc = [
    '# 개인정보 처리방침',
    '',
    '## 1. 수집 항목',
    '- 이메일',
    '- 연습 영상',
    '',
    '**보관 기간**은 탈퇴 시까지입니다.',
  ].join('\n');

  assert.deepEqual(parseMarkdown(doc), [
    { type: 'heading', level: 1, spans: [{ text: '개인정보 처리방침' }] },
    { type: 'heading', level: 2, spans: [{ text: '1. 수집 항목' }] },
    {
      type: 'list',
      ordered: false,
      items: [[{ text: '이메일' }], [{ text: '연습 영상' }]],
    },
    {
      type: 'paragraph',
      spans: [{ text: '보관 기간', bold: true }, { text: '은 탈퇴 시까지입니다.' }],
    },
  ]);
});

test('F5: 빈 문자열·공백은 블록을 만들지 않는다', () => {
  assert.deepEqual(parseMarkdown(''), []);
  assert.deepEqual(parseMarkdown('\n\n  \n'), []);
});
