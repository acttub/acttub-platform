import assert from 'node:assert/strict';
import test from 'node:test';
import { api, id } from './helpers/practice-api.mjs';

// api.ts 가 JSON 요청을 꾸리는 모양(메서드·Content-Type·본문 글자)을 호출마다 그대로 고정한다.
// 요청 설정을 한곳(jsonInit)으로 모을 때 서버가 받는 바이트가 한 글자도 달라지지 않았음을 이 표가 증명한다.
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

function captureFetch(t) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const headers = new Headers(init.headers);
    const u = new URL(url);
    calls.push({
      method: init.method ?? 'GET',
      path: u.pathname + u.search,
      contentType: headers.get('Content-Type'),
      requestId: headers.get('X-Request-Id'),
      body: init.body ?? null,
    });
    return new Response(null, { status: 204 });
  });
  return calls;
}

const CASES = [
  ['login', () => api.login({ provider: 'kakao', token: 't' }),
    { method: 'POST', path: '/v2/auth/login', contentType: 'application/json', body: '{"provider":"kakao","token":"t"}' }],
  ['logout', () => api.logout('r'),
    { method: 'POST', path: '/v2/auth/logout', contentType: 'application/json', body: '{"refresh_token":"r"}' }],
  ['saveProfile', () => api.saveProfile({ name: '니나' }),
    { method: 'PUT', path: '/v2/me/profile', contentType: 'application/json', body: '{"name":"니나"}' }],
  ['savePortfolioIntro', () => api.savePortfolioIntro(null),
    { method: 'PUT', path: '/v2/portfolio/intro', contentType: 'application/json', body: '{"intro":null}' }],
  ['updatePortfolioCredit', () => api.updatePortfolioCredit(id(1), { title: '갈매기' }),
    { method: 'PATCH', path: `/v2/portfolio/credits/${id(1)}`, contentType: 'application/json', body: '{"title":"갈매기"}' }],
  ['reorderPortfolioCredits', () => api.reorderPortfolioCredits({ ids: [id(1), id(2)] }),
    { method: 'PUT', path: '/v2/portfolio/credits/order', contentType: 'application/json', body: `{"ids":["${id(1)}","${id(2)}"]}` }],
  ['reorderPortfolioPhotos', () => api.reorderPortfolioPhotos({ ids: [id(3)] }),
    { method: 'PUT', path: '/v2/portfolio/photos/order', contentType: 'application/json', body: `{"ids":["${id(3)}"]}` }],
  ['setPortfolioShare', () => api.setPortfolioShare(true),
    { method: 'PUT', path: '/v2/portfolio/share', contentType: 'application/json', body: '{"enabled":true}' }],
  ['updateReadingScript', () => api.updateReadingScript(id(4), { title: '제목' }),
    { method: 'PATCH', path: `/v2/reading/scripts/${id(4)}`, contentType: 'application/json', body: '{"title":"제목"}' }],
  ['saveReadingProgress', () => api.saveReadingProgress(id(5), { request_id: id(9), index: 3 }),
    { method: 'PATCH', path: `/v2/reading/sessions/${id(5)}/progress`, contentType: 'application/json', body: `{"request_id":"${id(9)}","index":3}` }],
  ['setLineMemorization', () => api.setLineMemorization(id(6), 'memorized'),
    { method: 'PUT', path: `/v2/reading/lines/${id(6)}/memorization`, contentType: 'application/json', body: '{"status":"memorized"}' }],
  ['updateNotificationSettings', () => api.updateNotificationSettings({ evening: false }),
    { method: 'PATCH', path: '/v2/me/notification-settings', contentType: 'application/json', body: '{"evening":false}' }],
  ['registerPushToken', () => api.registerPushToken('tok', 'ios'),
    { method: 'POST', path: '/v2/push-tokens', contentType: 'application/json', body: '{"token":"tok","platform":"ios"}' }],
  ['unregisterPushToken', () => api.unregisterPushToken('tok'),
    { method: 'DELETE', path: '/v2/push-tokens', contentType: 'application/json', body: '{"token":"tok"}' }],
  ['saveActorMemory', () => api.saveActorMemory('goal', '붙잡기'),
    { method: 'PUT', path: '/v2/me/memory/goal', contentType: 'application/json', body: '{"value":"붙잡기"}' }],
  ['completeVideoIntent', () => api.completeVideoIntent(id(7), id(8)),
    { method: 'POST', path: `/v2/videos/intents/${id(7)}/complete`, contentType: 'application/json', requestId: id(8), body: '{}' }],
  ['setVideoFavorite', () => api.setVideoFavorite(id(2), true),
    { method: 'PATCH', path: `/v2/videos/${id(2)}`, contentType: 'application/json', body: '{"favorite":true}' }],
  ['purgeVideoFile', () => api.purgeVideoFile(id(2)),
    { method: 'POST', path: `/v2/videos/${id(2)}/purge-file`, contentType: 'application/json', body: '{}' }],
  ['patchPracticeGroup', () => api.patchPracticeGroup(id(1), { hidden: true }),
    { method: 'PATCH', path: `/v2/practices/${id(1)}/group`, contentType: 'application/json', body: '{"hidden":true}' }],
  ['cancelPractice', () => api.cancelPractice(id(1)),
    { method: 'POST', path: `/v2/practices/${id(1)}/cancel`, contentType: 'application/json', requestId: UUID, body: '{}' }],
  ['putNoteRating', () => api.putNoteRating(id(1), { rating: 'up', comment: null }),
    { method: 'PUT', path: `/v2/practices/${id(1)}/note/rating`, contentType: 'application/json', body: '{"rating":"up","comment":null}' }],
  ['updateEntry', () => api.updateEntry(id(2), { visibility: 'private' }),
    { method: 'PATCH', path: `/v2/entries/${id(2)}`, contentType: 'application/json', body: '{"visibility":"private"}' }],
  ['recordEntryView', () => api.recordEntryView(id(2), id(9)),
    { method: 'POST', path: `/v2/entries/${id(2)}/views`, contentType: 'application/json', body: `{"event_id":"${id(9)}"}` }],
  ['readNotifications', () => api.readNotifications({ group_keys: ['k'] }),
    { method: 'POST', path: '/v2/me/notifications/read', contentType: 'application/json', requestId: UUID, body: '{"group_keys":["k"]}' }],
];

for (const [name, call, expected] of CASES) {
  test(`api.${name}: 메서드·Content-Type·본문이 글자 그대로다`, async t => {
    const calls = captureFetch(t);
    await call().catch(() => {}); // 응답 해석은 이 표의 관심이 아니다 — 보낸 모양만 본다.
    assert.equal(calls.length, 1);
    const [sent] = calls;
    assert.equal(sent.method, expected.method);
    assert.equal(sent.path, expected.path);
    assert.equal(sent.contentType, expected.contentType);
    assert.equal(sent.body, expected.body);
    if (expected.requestId instanceof RegExp) assert.match(sent.requestId, expected.requestId);
    else assert.equal(sent.requestId, expected.requestId ?? null);
  });
}

test('api.retryPracticeAnalysis: 요청 id 를 안 주면 UUID 하나를 만들어 본문과 헤더에 같이 싣는다', async t => {
  const calls = captureFetch(t);
  await api.retryPracticeAnalysis(id(1)).catch(() => {});
  const [sent] = calls;
  assert.equal(sent.method, 'POST');
  assert.match(sent.requestId, UUID);
  assert.equal(sent.body, `{"request_id":"${sent.requestId}"}`);
});
