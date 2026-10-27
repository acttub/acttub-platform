import assert from 'node:assert/strict';
import { test } from 'node:test';

/** 설정에서 고른 언어(SOMA-827 후속). 기기 저장소의 값을 앱이 켜질 때 한 번 읽어 표시 언어를 정한다. */
function secureStore(initial) {
  const values = new Map(initial ? [['acttub.language', initial]] : []);
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => void values.set(key, value),
    deleteItemAsync: async (key) => void values.delete(key),
  };
}

async function loadWith(store, deviceLanguageCode = 'ko') {
  globalThis.require = (name) => {
    if (name === 'expo-secure-store') return store;
    if (name === 'expo-localization') return { getLocales: () => [{ languageCode: deviceLanguageCode }] };
    throw new Error(`unexpected ${name}`);
  };
  return import(`../lib/i18n.ts?case=${Math.random()}`);
}

test('고른 언어가 없으면 기기 언어를 따른다', async () => {
  const i18n = await loadWith(secureStore(null), 'en');
  assert.equal(i18n.languagePreference(), 'system');
  assert.equal(i18n.currentLanguage(), 'en');
});

test('설정에서 고른 언어가 있으면 기기 언어보다 먼저다', async () => {
  const i18n = await loadWith(secureStore('en'), 'ko');
  assert.equal(i18n.languagePreference(), 'en');
  assert.equal(i18n.currentLanguage(), 'en');
  assert.equal(i18n.translate('settings.title'), 'Settings');
});

test('고른 언어를 저장하고 바로 적용한다 — 앱 뿌리에 알려 화면을 다시 그린다. 기기 설정 따름은 저장 값을 지운다', async () => {
  const store = secureStore(null);
  const i18n = await loadWith(store, 'ko');
  let notified = 0;
  const off = i18n.onLanguageChange(() => { notified += 1; });
  await i18n.saveLanguagePreference('en');
  assert.equal(store.values.get('acttub.language'), 'en');
  // 다시 켜지 않아도 바로 바뀐다(10/28 폰 확인 — 예전엔 껐다 켜야 바뀌었다).
  assert.equal(i18n.currentLanguage(), 'en');
  assert.equal(i18n.languagePreference(), 'en');
  assert.equal(notified, 1);
  await i18n.saveLanguagePreference('system');
  assert.equal(store.values.has('acttub.language'), false);
  assert.equal(i18n.currentLanguage(), 'ko');
  off();
  await i18n.saveLanguagePreference('en');
  assert.equal(notified, 2);
});

test('저장소를 못 쓰면 기기 언어로 가고, 이상한 값은 무시한다', async () => {
  const broken = { getItem: () => { throw new Error('no module'); } };
  assert.equal((await loadWith(broken, 'en')).currentLanguage(), 'en');
  assert.equal((await loadWith(secureStore('fr'), 'ko')).languagePreference(), 'system');
});
