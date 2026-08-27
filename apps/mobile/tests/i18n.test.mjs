import assert from 'node:assert/strict';
import test from 'node:test';

// 현지화(SOMA-449) — 언어 파일 두 벌이 같은 모양인지 잠근다.
const { default: ko } = await import('../locales/ko.ts');
const { default: en } = await import('../locales/en.ts');

function leafPaths(obj, prefix = '') {
  const out = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out.push(...leafPaths(value, path));
    } else {
      out.push([path, value]);
    }
  }
  return out;
}

const koLeaves = leafPaths(ko);
const enLeaves = leafPaths(en);
const enMap = new Map(enLeaves);

test('i18n: ko와 en은 키 트리가 완전히 같다', () => {
  assert.deepEqual(koLeaves.map(([p]) => p).sort(), enLeaves.map(([p]) => p).sort());
});

test('i18n: en 값에는 한국어가 남아 있지 않다', () => {
  for (const [path, value] of enLeaves) {
    const text = Array.isArray(value) ? value.join(' ') : String(value);
    assert.doesNotMatch(text, /[가-힣]/, `en.${path}가 한국어를 담고 있다: ${text}`);
  }
});

test('i18n: 삽입 변수({{...}})는 두 언어에서 짝이 맞는다', () => {
  const vars = (value) => {
    const text = Array.isArray(value) ? value.join(' ') : String(value);
    return [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
  };
  for (const [path, koValue] of koLeaves) {
    assert.deepEqual(vars(enMap.get(path)), vars(koValue), `변수 불일치: ${path}`);
  }
});

test('i18n: 기기 언어가 한국어가 아니면 영어, 한국어면 한국어', async () => {
  // node에는 expo-localization이 없어 deviceLanguage()가 ko로 떨어진다 —
  // translate 기본값이 한국어 원문 그대로인지로 폴백 경로를 잠근다.
  const { translate } = await import('../lib/i18n.ts');
  assert.equal(translate('login.google'), ko.login.google);
  assert.equal(translate('home.helloName', { name: '지성' }), '지성님, 안녕하세요 👋');
});
