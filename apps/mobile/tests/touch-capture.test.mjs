import assert from 'node:assert/strict';
import test from 'node:test';

import { tapFromTouch, textInside } from '../lib/touch-capture.ts';

// React 트리 흉내: node(props, ...children) 로 만들고 부모·형제를 잇는다.
function node(props, ...children) {
  const fiber = { memoizedProps: props, child: null, sibling: null, return: null };
  children.forEach((c, i) => {
    c.return = fiber;
    if (i === 0) fiber.child = c;
    else children[i - 1].sibling = c;
  });
  return fiber;
}
const press = () => {};
const touch = (target) => ({ _targetInst: target, nativeEvent: { pageX: 10, pageY: 20 } });

test('touch-capture: 버튼 안 글자를 누르면 버튼 글자를 이름으로 쓴다', () => {
  const label = node({ children: '연습 시작' });
  node({ onPress: press }, node({}, node({ children: '🎬' })), node({}, label));
  assert.deepEqual(tapFromTouch(touch(label)), { label: '🎬 연습 시작', source: 'text', x: 10, y: 20 });
});

test('touch-capture: 버튼 여백을 눌러도 안에 든 글자를 찾는다', () => {
  const pad = node({});
  const button = node({ onPress: press }, pad, node({ children: ['다음', ' ', 2] }));
  assert.equal(tapFromTouch(touch(pad)).label, '다음 2');
  assert.equal(textInside(button), '다음 2');
});

test('touch-capture: ph-label·접근성 이름이 글자보다 먼저고, 바깥 ph-label 은 구역으로 남긴다', () => {
  const icon = node({});
  node({ 'ph-label': 'home-cards' }, node({ onPress: press, accessibilityLabel: '설정 열기' }, icon));
  assert.deepEqual(tapFromTouch(touch(icon)), { label: '설정 열기', source: 'accessibilityLabel', area: 'home-cards', x: 10, y: 20 });

  const inner = node({ children: '보기' });
  node({ onPress: press, 'ph-label': 'reading-open' }, inner);
  assert.equal(tapFromTouch(touch(inner)).source, 'ph-label');
  assert.equal(tapFromTouch(touch(inner)).label, 'reading-open');
});

test('touch-capture: 누를 수 없는 자리와 ph-no-capture 안은 기록하지 않는다', () => {
  const bg = node({});
  node({}, bg);
  assert.equal(tapFromTouch(touch(bg)), null);

  const secret = node({ children: '비밀' });
  node({ 'ph-no-capture': true }, node({ onPress: press }, secret));
  assert.equal(tapFromTouch(touch(secret)), null);
  assert.equal(tapFromTouch({}), null);
});

test('touch-capture: 이름은 80자에서 자르고, 이름이 없으면 빈 이름으로 남긴다', () => {
  const long = node({ children: '가'.repeat(200) });
  node({ onPress: press }, long);
  assert.equal(tapFromTouch(touch(long)).label.length, 80);

  const empty = node({ onLongPress: press });
  assert.deepEqual(tapFromTouch(touch(empty)), { label: '', source: 'none', x: 10, y: 20 });
});

test('touch-capture: 이벤트에 인스턴스가 없으면 대상 노드의 React 내부 키에서 찾는다', () => {
  const label = node({ children: '확인' });
  node({ onPress: press }, label);
  const target = { ['__reactFiber$abc']: label };
  assert.equal(tapFromTouch({ target }).label, '확인');
});
