import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('설정과 공지 포스터 소스는 번역 키와 분석 소스를 사용한다', () => {
  const ko = read('../locales/ko.ts');
  const en = read('../locales/en.ts');
  const settings = read('../app/settings.tsx');
  const poster = read('../components/announcement-poster.tsx');
  for (const key of ['settingsTitle', 'settingsBody', 'dismissForever', 'samplePlay', 'sampleStop']) {
    assert.match(ko, new RegExp(`${key}:`));
    assert.match(en, new RegExp(`${key}:`));
  }
  // 홍보 문구는 서버 포스터(V29 seed)로 옮겼다 — 앱 번역에 남지 않는다.
  for (const key of ['promoBadge', 'promoTitle', 'promoBody']) {
    assert.doesNotMatch(ko, new RegExp(`${key}:`));
    assert.doesNotMatch(en, new RegExp(`${key}:`));
  }
  // 켜기 스위치는 설정 화면에서 대본 탭 위로 옮겼다(SOMA-664). 출처 이름은 'settings' 그대로 쓴다.
  assert.match(readFileSync(new URL('../app/(tabs)/reading.tsx', import.meta.url), 'utf8'), /enable\('settings'\)/);
  assert.doesNotMatch(settings, /useCloudVoice/);
  assert.match(poster, /enable\('promo'\)/);
});
