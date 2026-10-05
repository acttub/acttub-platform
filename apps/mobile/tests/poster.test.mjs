import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
  LEGACY_PROMO_KEY,
  LEGACY_PROMO_SLUG,
  POSTERS_KEY,
  ctaOf,
  imageAssetOf,
  audioAssetOf,
  koreaDay,
  loadPosterState,
  markDismissed,
  markShown,
  parsePosterState,
  pickPoster,
} from '../lib/poster.ts';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const now = Date.parse('2026-10-05T12:00:00+09:00');
const today = koreaDay(now);
const off = { available: true, enabled: false, consent: 'undecided' };
const on = { available: true, enabled: true, consent: 'granted' };

function poster(overrides = {}) {
  return {
    slug: 'notice', revision: 1, frequency: 'daily', audience: 'all', dismissible: true,
    badge: null, title: '제목', body: null, image_url: null, image_asset: null, audio_asset: null,
    cta_label: null, cta_action: 'none', cta_target: null, ...overrides,
  };
}

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: async (key) => (data.has(key) ? data.get(key) : null),
    setItem: async (key, value) => { data.set(key, value); },
    removeItem: async (key) => { data.delete(key); },
  };
}

test('koreaDay 는 한국 날짜로 끊는다', () => {
  assert.equal(koreaDay(Date.parse('2026-10-04T15:00:00Z')), '2026-10-05');
  assert.equal(koreaDay(Date.parse('2026-10-04T14:59:59Z')), '2026-10-04');
});

test('pickPoster 는 서버 순서대로 처음 보일 수 있는 것을 고른다', () => {
  const posters = [poster({ slug: 'a' }), poster({ slug: 'b' })];
  assert.equal(pickPoster(posters, {}, { today, cloudVoice: off })?.slug, 'a');
  assert.equal(pickPoster([], {}, { today, cloudVoice: off }), null);
});

test('daily 는 오늘(한국 날짜) 이미 봤으면 넘기고 다음 날 다시 보인다', () => {
  const posters = [poster({ slug: 'a' }), poster({ slug: 'b' })];
  const seen = markShown({}, posters[0], today);
  assert.equal(pickPoster(posters, seen, { today, cloudVoice: off })?.slug, 'b');
  assert.equal(pickPoster(posters, seen, { today: '2026-10-06', cloudVoice: off })?.slug, 'a');
});

test('once 는 한 번 보이면 다시 보이지 않는다', () => {
  const once = poster({ slug: 'once', frequency: 'once' });
  const seen = markShown({}, once, today);
  assert.equal(seen.once.shownOnce, true);
  assert.equal(pickPoster([once], seen, { today: '2026-12-01', cloudVoice: off }), null);
});

test('다시 보지 않기를 누른 포스터는 넘긴다', () => {
  const a = poster({ slug: 'a' });
  const state = markDismissed({}, a);
  assert.equal(pickPoster([a], state, { today: '2026-12-01', cloudVoice: off }), null);
});

test('cloud_voice_off 는 고품질 목소리를 쓸 수 있고 아직 켜지 않은 사람에게만 보인다', () => {
  const promo = poster({ slug: 'cv', audience: 'cloud_voice_off' });
  assert.equal(pickPoster([promo], {}, { today, cloudVoice: off })?.slug, 'cv');
  assert.equal(pickPoster([promo], {}, { today, cloudVoice: { ...off, consent: 'denied' } })?.slug, 'cv');
  assert.equal(pickPoster([promo], {}, { today, cloudVoice: { ...off, enabled: true } })?.slug, 'cv',
    '켰지만 동의가 없으면 아직 안 켠 것이다');
  assert.equal(pickPoster([promo], {}, { today, cloudVoice: on }), null);
  assert.equal(pickPoster([promo], {}, { today, cloudVoice: { ...off, available: false } }), null);
  assert.equal(pickPoster([promo], {}, { today, cloudVoice: null }), null, '상태를 모르면 띄우지 않는다');
  assert.equal(pickPoster([poster()], {}, { today, cloudVoice: null })?.slug, 'notice', 'all 은 상태와 무관하다');
});

test('revision 이 바뀌면 그 slug 의 봤음·다시 보지 않기는 없던 것이 된다', () => {
  const v1 = poster({ slug: 'a', revision: 1, frequency: 'once' });
  const dismissed = markDismissed(markShown({}, v1, today), v1);
  assert.equal(pickPoster([v1], dismissed, { today: '2026-12-01', cloudVoice: off }), null);
  const v2 = { ...v1, revision: 2 };
  assert.equal(pickPoster([v2], dismissed, { today, cloudVoice: off })?.slug, 'a');
  const reshown = markShown(dismissed, v2, today);
  assert.deepEqual(reshown.a, { revision: 2, lastShownDay: today, shownOnce: true, dismissedForever: false });
});

test('깨진 저장값은 빈 상태로 읽는다', () => {
  assert.deepEqual(parsePosterState(null), {});
  assert.deepEqual(parsePosterState('{'), {});
  assert.deepEqual(parsePosterState('[]'), {});
  assert.deepEqual(parsePosterState('{"a":{"revision":"x"}}'), {});
});

test('옛 홍보 키의 다시 보지 않기와 마지막 날짜를 cloud-voice-launch(revision 1)로 옮기고 옛 키를 지운다', async () => {
  const storage = memoryStorage({ [LEGACY_PROMO_KEY]: JSON.stringify({ dismissedForever: true, lastShownDay: '2026-10-03' }) });
  const state = await loadPosterState(storage);
  assert.deepEqual(state[LEGACY_PROMO_SLUG], { revision: 1, lastShownDay: '2026-10-03', shownOnce: false, dismissedForever: true });
  assert.equal(storage.data.has(LEGACY_PROMO_KEY), false);
  assert.deepEqual(JSON.parse(storage.data.get(POSTERS_KEY)), state);
  const promo = poster({ slug: LEGACY_PROMO_SLUG, audience: 'cloud_voice_off' });
  assert.equal(pickPoster([promo], state, { today, cloudVoice: off }), null);
  assert.equal(pickPoster([{ ...promo, revision: 2 }], state, { today, cloudVoice: off })?.slug, LEGACY_PROMO_SLUG);
});

test('옛 홍보 키가 오늘 본 기록만 가졌으면 오늘은 다시 띄우지 않는다', async () => {
  const storage = memoryStorage({ [LEGACY_PROMO_KEY]: JSON.stringify({ dismissedForever: false, lastShownDay: today }) });
  const state = await loadPosterState(storage);
  const promo = poster({ slug: LEGACY_PROMO_SLUG, audience: 'cloud_voice_off' });
  assert.equal(pickPoster([promo], state, { today, cloudVoice: off }), null);
  assert.equal(pickPoster([promo], state, { today: '2026-10-06', cloudVoice: off })?.slug, LEGACY_PROMO_SLUG);
});

test('옛 키가 없으면 저장된 새 상태를 그대로 읽는다', async () => {
  const saved = { a: { revision: 3, lastShownDay: today, shownOnce: true, dismissedForever: false } };
  const storage = memoryStorage({ [POSTERS_KEY]: JSON.stringify(saved) });
  assert.deepEqual(await loadPosterState(storage), saved);
  assert.deepEqual(await loadPosterState(memoryStorage()), {});
});

test('이미지·소리는 앱이 아는 번들 자산 또는 원격 주소만, 버튼은 안전한 대상만 쓴다', () => {
  assert.deepEqual(imageAssetOf(poster({ image_asset: 'mascot-reading' })), 'mascot-reading');
  assert.equal(imageAssetOf(poster({ image_asset: 'unknown' })), null);
  assert.equal(audioAssetOf(poster({ audio_asset: 'cloud-voice-sample' })), 'cloud-voice-sample');
  assert.equal(audioAssetOf(poster({ audio_asset: 'other' })), null);
  assert.deepEqual(ctaOf(poster({ cta_label: '켜기', cta_action: 'cloud_voice_enable' })), { kind: 'cloud_voice_enable', label: '켜기' });
  assert.deepEqual(ctaOf(poster({ cta_label: '보기', cta_action: 'route', cta_target: '/reading' })), { kind: 'route', label: '보기', target: '/reading' });
  assert.equal(ctaOf(poster({ cta_label: '보기', cta_action: 'route', cta_target: 'reading' })), null);
  assert.deepEqual(ctaOf(poster({ cta_label: '열기', cta_action: 'url', cta_target: 'https://acttub.com' })), { kind: 'url', label: '열기', target: 'https://acttub.com' });
  assert.equal(ctaOf(poster({ cta_label: '열기', cta_action: 'url', cta_target: 'http://acttub.com' })), null);
  assert.equal(ctaOf(poster({ cta_label: null, cta_action: 'cloud_voice_enable' })), null);
  assert.equal(ctaOf(poster({ cta_label: '닫기', cta_action: 'none' })), null);
});

test('소스 계약: 홈은 AnnouncementPoster 를 쓰고 옛 홍보 컴포넌트·로직은 없다', () => {
  const home = read('../app/(tabs)/index.tsx');
  assert.match(home, /import \{ AnnouncementPoster \} from '@\/components\/announcement-poster'/);
  assert.match(home, /<AnnouncementPoster/);
  assert.doesNotMatch(home, /CloudVoicePromo/);
  assert.equal(existsSync(new URL('../components/cloud-voice-promo.tsx', import.meta.url)), false);
  assert.equal(existsSync(new URL('../lib/cloud-voice-promo.ts', import.meta.url)), false);
  const component = read('../components/announcement-poster.tsx');
  for (const event of ['poster_shown', 'poster_cta', 'poster_close', 'poster_dismiss']) assert.match(component, new RegExp(`'${event}'`));
  assert.doesNotMatch(component, /cloud_voice_promo_/);
  assert.match(component, /enable\('promo'\)/);
  assert.match(component, /api\.getPosters\(/);
  const api = read('../lib/api.ts');
  assert.match(api, /getPosters\(/);
  assert.match(api, /\/v2\/app\/posters/);
});
