import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('설정과 프로모션 소스는 번역 키와 분석 소스를 사용한다', () => {
  const ko = read('../locales/ko.ts');
  const en = read('../locales/en.ts');
  const settings = read('../app/settings.tsx');
  const promo = read('../components/cloud-voice-promo.tsx');
  for (const key of ['settingsTitle', 'settingsBody', 'promoBadge', 'promoTitle', 'promoBody', 'enable', 'dismissForever']) {
    assert.match(ko, new RegExp(`${key}:`));
    assert.match(en, new RegExp(`${key}:`));
  }
  assert.match(settings, /enable\('settings'\)/);
  assert.match(promo, /enable\('promo'\)/);
});
