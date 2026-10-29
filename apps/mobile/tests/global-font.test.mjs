import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stubModules } from './helpers/stub-modules.mjs';

// RN 의 Text·TextInput 대신 render 를 가진 가짜 컴포넌트를 주고, 모듈을 불러온 뒤 그린 결과의 글꼴을 본다.
globalThis.__globalFont = {
  Text: { render: props => ({ type: 'Text', props: { style: props.style, children: props.children } }) },
  TextInput: { render: () => null },
};
stubModules({
  'react-native': `const s = globalThis.__globalFont;
    const flatten = style => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : (style ?? undefined);
    export const StyleSheet = { flatten };
    // 기기 종류는 ios 로 둔다 — 안드로이드 한 단계 가볍게(10/29)는 font-weight.test.mjs 가 본다.
    export const Platform = { OS: 'ios' };
    export const Text = s.Text;
    export const TextInput = s.TextInput;`,
  react: `export default { cloneElement: (element, props) => ({ ...element, props: { ...element.props, ...props } }) };`,
});
await import('../lib/global-font.ts');
await import('../lib/global-font.ts');
const { Text, TextInput } = globalThis.__globalFont;
const draw = style => Text.render({ style, children: '안녕' });

test('글자 굵기에 맞는 Pretendard 파일을 고르고 가짜 볼드는 끈다', () => {
  assert.deepEqual(draw([{ fontSize: 14 }, { fontWeight: '700' }]).props.style, [
    [{ fontSize: 14 }, { fontWeight: '700' }],
    { fontFamily: 'Pretendard-Bold', fontWeight: 'normal' },
  ]);
  assert.equal(draw({ fontWeight: '600' }).props.style[1].fontFamily, 'Pretendard-SemiBold');
  assert.equal(draw(undefined).props.style[1].fontFamily, 'Pretendard');
});

test('아이콘 글꼴처럼 패밀리를 직접 정한 글자는 건드리지 않는다', () => {
  assert.deepEqual(draw({ fontFamily: 'Feather' }).props.style, { fontFamily: 'Feather' });
});

test('그릴 것이 없으면 그대로 두고, 두 번 불러와도 한 번만 덧씌운다', () => {
  assert.equal(TextInput.render({}), null);
  assert.equal(Text.__globalFontApplied, true);
  assert.equal(draw({}).props.style.length, 2);
});
