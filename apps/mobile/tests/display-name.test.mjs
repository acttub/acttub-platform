import assert from 'node:assert/strict';
import test from 'node:test';

import { displayNameFor } from '../lib/display-name.ts';

test('F12: 저장된 이름이 있으면 그대로 쓴다', () => {
  assert.equal(displayNameFor('류지성', 'jisung@gmail.com'), '류지성');
  assert.equal(displayNameFor('  지성  ', null), '지성');
});

test('F12: 저장된 이름이 없으면 이메일 앞부분으로 부른다', () => {
  assert.equal(displayNameFor(null, 'jisung@gmail.com'), 'jisung');
  assert.equal(displayNameFor('   ', 'jisung@gmail.com'), 'jisung');
});

test('F12: 이메일 앞부분의 구분자와 숫자 꼬리를 정리한다', () => {
  assert.equal(displayNameFor(null, 'jisung20061227@gmail.com'), 'jisung');
  assert.equal(displayNameFor(null, 'ryu.jisung@gmail.com'), 'ryu jisung');
  assert.equal(displayNameFor(null, 'ryu_ji-sung@gmail.com'), 'ryu ji sung');
});

test('F12: 숫자만으로 된 아이디는 원본을 유지한다', () => {
  assert.equal(displayNameFor(null, '19991227@gmail.com'), '19991227');
});

test('F12: 이름도 이메일도 없으면 null', () => {
  assert.equal(displayNameFor(null, null), null);
  assert.equal(displayNameFor(undefined, undefined), null);
  assert.equal(displayNameFor(null, '@gmail.com'), null);
});
