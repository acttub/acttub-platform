import assert from 'node:assert/strict';
import test from 'node:test';

import { api, httpResponses, id, jwtWithSubject, practice, sample, tokenStore, video } from './helpers/api-upload-task.mjs';

// 화면이 부르는 api.* 가 서버 OpenAPI 에 있는 경로·메서드로, 스키마에 맞는 본문을 보내고,
// 서버 응답을 그대로(또는 정해진 정규화를 거쳐) 돌려주는지 본다. 요청·응답 스키마 검사는 httpResponses 가 한다.
const USER = { id: id(90), email: 'actor@test.dev', status: 'active' };
const ACCESS = jwtWithSubject(USER.id);
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

test.before(async () => {
  assert.equal(await tokenStore.setTokens(ACCESS, 'refresh-1', USER), true);
});

const scriptBody = {
  request_id: id(20),
  title: '갈매기',
  source: 'paste',
  raw_text: '니나: 나는 갈매기',
  characters: [{ name: '니나' }],
  lines: [{ ordinal: 1, kind: 'dialogue', character_index: 0, text: '나는 갈매기' }],
};
const sessionBody = {
  request_id: id(21),
  my_character_ids: [id(30)],
  mode: 'read',
  start_line_id: id(31),
  end_line_id: id(32),
  advance: 'manual',
  record: true,
};

// [이름, 호출, 서버가 받는 요청, 서버 답]. auth: false 는 로그인 없이 보내는 공개 경로다.
const CASES = [
  ['authProviders', () => api.authProviders(),
    { method: 'get', path: '/v2/auth/providers', auth: false }, { body: { providers: ['kakao', 'apple'] } }],
  ['consentDocuments', () => api.consentDocuments(),
    { method: 'get', path: '/v2/consents/documents', auth: false }, { body: sample('ConsentDocumentsResponse') }],
  ['consentEntry', () => api.consentEntry(),
    { method: 'get', path: '/v2/consents/entry' }, { body: sample('ConsentEntryResponse') }],
  ['getPosters', () => api.getPosters({ platform: 'ios', locale: 'ko', app_version: '0.1.0' }),
    { method: 'get', path: '/v2/app/posters?platform=ios&locale=ko&app_version=0.1.0' }, { body: sample('AppPosterList') }],
  ['getCloudVoiceStatus', () => api.getCloudVoiceStatus(),
    { method: 'get', path: '/v2/reading/voice/status' },
    { body: { available: true, free_until: '2026-12-31T15:00:00Z', consent: 'granted', daily_limit: 30, daily_used: 2 } }],
  ['synthesizeCloudVoice', () => api.synthesizeCloudVoice('  나는 갈매기  ', 'F2'),
    { method: 'post', path: '/v2/reading/voice', body: { text: '나는 갈매기', voice: 'F2' } },
    { body: { audio_url: 'https://storage.test/voice.mp3', cached: true, expires_in: 600 } }],
  ['me', () => api.me(),
    { method: 'get', path: '/v2/me' }, { body: sample('MeResponse') }],
  ['createProfilePhotoIntent', () => api.createProfilePhotoIntent({ content_type: 'image/jpeg', size_bytes: 120_000 }),
    { method: 'post', path: '/v2/me/photo', body: { content_type: 'image/jpeg', size_bytes: 120_000 } },
    { status: 201, body: sample('PhotoUploadResponse') }],
  ['completeProfilePhoto', () => api.completeProfilePhoto(),
    { method: 'post', path: '/v2/me/photo/complete' }, { body: sample('MeResponse') }],
  ['deleteProfilePhoto', () => api.deleteProfilePhoto(),
    { method: 'delete', path: '/v2/me/photo' }, { status: 204 }],
  ['deleteMe', () => api.deleteMe(),
    { method: 'delete', path: '/v2/me' }, { body: { status: 'deactivated', deactivated_at: '2026-10-20T01:00:00Z' } }],
  ['portfolio', () => api.portfolio(),
    { method: 'get', path: '/v2/portfolio' }, { body: sample('Portfolio') }],
  ['createPortfolioCredit', () => api.createPortfolioCredit({ title: '갈매기', role: '니나', year: 2025, kind: 'play' }),
    { method: 'post', path: '/v2/portfolio/credits', body: { title: '갈매기', role: '니나', year: 2025, kind: 'play' } },
    { status: 201, body: { id: id(5), title: '갈매기', role: '니나', year: 2025, kind: 'play' } }],
  ['deletePortfolioCredit', () => api.deletePortfolioCredit(id(5)),
    { method: 'delete', path: `/v2/portfolio/credits/${id(5)}` }, { status: 204 }],
  ['createPortfolioPhotoIntent', () => api.createPortfolioPhotoIntent({ content_type: 'image/jpeg', size_bytes: 300_000 }),
    { method: 'post', path: '/v2/portfolio/photos', body: { content_type: 'image/jpeg', size_bytes: 300_000 } },
    { status: 201, body: sample('PortfolioPhotoUploadResponse') }],
  ['completePortfolioPhoto', () => api.completePortfolioPhoto(id(6)),
    { method: 'post', path: `/v2/portfolio/photos/${id(6)}/complete` }, { body: sample('Portfolio') }],
  ['deletePortfolioPhoto', () => api.deletePortfolioPhoto(id(6)),
    { method: 'delete', path: `/v2/portfolio/photos/${id(6)}` }, { status: 204 }],
  ['listReadingExamples', () => api.listReadingExamples(),
    { method: 'get', path: '/v2/reading/examples' }, { body: sample('ReadingExampleList') }],
  ['startReadingExample', () => api.startReadingExample('cafe', { request_id: id(9) }),
    { method: 'post', path: '/v2/reading/examples/cafe/start', body: { request_id: id(9) } },
    { status: 201, body: { script_id: id(10), created: true } }],
  ['listReadingScripts(검색어 없음)', () => api.listReadingScripts(),
    { method: 'get', path: '/v2/reading/scripts' }, { body: sample('ReadingScriptList') }],
  ['listReadingScripts(검색어)', () => api.listReadingScripts('햄릿 & 오필리아'),
    { method: 'get', path: '/v2/reading/scripts?q=%ED%96%84%EB%A6%BF%20%26%20%EC%98%A4%ED%95%84%EB%A6%AC%EC%95%84' },
    { body: sample('ReadingScriptList') }],
  ['createScriptUpload', () => api.createScriptUpload({ file_name: '갈매기.pdf', byte_size: 48_000 }),
    { method: 'post', path: '/v2/reading/uploads', body: { file_name: '갈매기.pdf', byte_size: 48_000 } },
    { status: 201, body: sample('ReadingUpload') }],
  ['completeScriptUpload', () => api.completeScriptUpload(id(7)),
    { method: 'post', path: `/v2/reading/uploads/${id(7)}/complete` }, { status: 204 }],
  ['importScript', () => api.importScript({ request_id: id(8), source: 'paste', raw_text: '니나: 나는 갈매기', allow_duplicate: false, skip_script_check: true }),
    { method: 'post', path: '/v2/reading/imports',
      body: { request_id: id(8), source: 'paste', raw_text: '니나: 나는 갈매기', allow_duplicate: false, skip_script_check: true } },
    { status: 202, body: { import_id: id(8), duplicate_script_id: null } }],
  ['getScriptImport', () => api.getScriptImport(id(8)),
    { method: 'get', path: `/v2/reading/imports/${id(8)}` }, { body: sample('ReadingImport') }],
  ['createReadingScript', () => api.createReadingScript(scriptBody),
    { method: 'post', path: '/v2/reading/scripts', body: scriptBody, requestId: scriptBody.request_id },
    { status: 201, body: sample('ReadingScript') }],
  ['getReadingScript', () => api.getReadingScript(id(1)),
    { method: 'get', path: `/v2/reading/scripts/${id(1)}` }, { body: sample('ReadingScript') }],
  ['createSampleScript', () => api.createSampleScript({ request_id: id(60), experience: 'beginner', emotion: '서운함', character_count: 1, length_minutes: 1 }),
    { method: 'post', path: '/v2/sample-scripts',
      body: { request_id: id(60), experience: 'beginner', emotion: '서운함', character_count: 1, length_minutes: 1 } },
    { status: 201, body: sample('SampleScript') }],
  ['getSampleScript', () => api.getSampleScript(id(61)),
    { method: 'get', path: `/v2/sample-scripts/${id(61)}` }, { body: sample('SampleScript') }],
  ['reviseSampleScript', () => api.reviseSampleScript(id(61), { base_version: 1, text: '더 담담하게', length_minutes: 3 }),
    { method: 'post', path: `/v2/sample-scripts/${id(61)}/revisions`, body: { base_version: 1, text: '더 담담하게', length_minutes: 3 } },
    { body: sample('SampleScript') }],
  ['restoreSampleScript', () => api.restoreSampleScript(id(61), 1),
    { method: 'post', path: `/v2/sample-scripts/${id(61)}/restore`, body: { version: 1 } }, { body: sample('SampleScript') }],
  ['saveSampleScript', () => api.saveSampleScript(id(61)),
    { method: 'post', path: `/v2/sample-scripts/${id(61)}/save` }, { status: 201, body: sample('SampleScriptSaved') }],
  ['updateReadingScriptLine', () => api.updateReadingScriptLine(id(1), id(31), { text: '나는 배우야' }),
    { method: 'patch', path: `/v2/reading/scripts/${id(1)}/lines/${id(31)}`, body: { text: '나는 배우야' } },
    { body: sample('ReadingScript') }],
  ['deleteReadingScript', () => api.deleteReadingScript(id(1)),
    { method: 'delete', path: `/v2/reading/scripts/${id(1)}` }, { status: 204 }],
  ['startReadingSession', () => api.startReadingSession(id(1), sessionBody),
    { method: 'post', path: `/v2/reading/scripts/${id(1)}/sessions`, body: sessionBody, requestId: sessionBody.request_id },
    { status: 201, body: sample('ReadingSession') }],
  ['listReadingSessions', () => api.listReadingSessions(id(1)),
    { method: 'get', path: `/v2/reading/scripts/${id(1)}/sessions` }, { body: sample('ReadingSessionList') }],
  ['getReadingSession', () => api.getReadingSession(id(3)),
    { method: 'get', path: `/v2/reading/sessions/${id(3)}` }, { body: sample('ReadingSession') }],
  ['deleteReadingSession', () => api.deleteReadingSession(id(3)),
    { method: 'delete', path: `/v2/reading/sessions/${id(3)}` }, { status: 204 }],
  ['putReadingSessionRating', () => api.putReadingSessionRating(id(3), { request_id: id(11), rating: 'bad', comment: '목소리가 작아요' }),
    { method: 'put', path: `/v2/reading/sessions/${id(3)}/rating`, body: { request_id: id(11), rating: 'bad', comment: '목소리가 작아요' } },
    { body: { rating: 'bad', comment: '목소리가 작아요', updated_at: '2026-10-20T01:00:00Z' } }],
  ['transferGuestData', () => api.transferGuestData({ code: '482913', memory_choice: 'guest' }),
    { method: 'post', path: '/v2/guest-transfers', body: { code: '482913', memory_choice: 'guest' } },
    { body: { transferred: true } }],
  ['notificationSettings', () => api.notificationSettings(),
    { method: 'get', path: '/v2/me/notification-settings' },
    { body: { analysis_done: true, challenge: false, evening_reminder: true } }],
  ['recordSignupAttribution', () => api.recordSignupAttribution({ source: 'airbridge', platform: 'ios', channel: 'instagram', campaign: '가을' }),
    { method: 'put', path: '/v2/me/signup-attribution', body: { source: 'airbridge', platform: 'ios', channel: 'instagram', campaign: '가을' } },
    { status: 204 }],
  ['recordAirbridgeDevice', () => api.recordAirbridgeDevice({ platform: 'android', device_uuid: id(12) }),
    { method: 'put', path: '/v2/me/airbridge-device', body: { platform: 'android', device_uuid: id(12) } }, { status: 204 }],
  ['recordDiscoveryAnswer', () => api.recordDiscoveryAnswer({ source: null, detail: null, other_text: null }),
    { method: 'put', path: '/v2/me/discovery', body: { source: null, detail: null, other_text: null } }, { status: 204 }],
  ['actorMemory', () => api.actorMemory(),
    { method: 'get', path: '/v2/me/memory' }, { body: sample('ActorMemoryResponse') }],
  ['deleteActorMemory', () => api.deleteActorMemory('goal'),
    { method: 'delete', path: '/v2/me/memory/goal' }, { status: 204 }],
  ['deleteAllActorMemory', () => api.deleteAllActorMemory(),
    { method: 'delete', path: '/v2/me/memory' }, { status: 204 }],
  ['createVideoIntent', () => api.createVideoIntent({ request_id: id(13), content_type: 'video/mp4', byte_size: 1024, duration_ms: 30_000 }),
    { method: 'post', path: '/v2/videos/intents',
      body: { request_id: id(13), content_type: 'video/mp4', byte_size: 1024, duration_ms: 30_000 }, requestId: id(13) },
    { status: 201, body: { intent_id: id(14), upload_url: 'https://storage.test/put', expires_at: '2026-10-20T00:30:00Z' } }],
  ['listVideos(커서)', () => api.listVideos('favorite', 'c-2'),
    { method: 'get', path: '/v2/videos?filter=favorite&cursor=c-2' }, { body: sample('VideoList') }],
  ['deleteVideo', () => api.deleteVideo(id(2)),
    { method: 'delete', path: `/v2/videos/${id(2)}` }, { status: 204 }],
  ['listNotifications(커서)', () => api.listNotifications('2026-10-20 1'),
    { method: 'get', path: '/v2/me/notifications?cursor=2026-10-20%201' }, { body: sample('ChallengeNotifications') }],
  ['listSavedEntries', () => api.listSavedEntries(),
    { method: 'get', path: '/v2/me/saved-entries' }, { body: sample('SavedChallengeEntries') }],
  ['listSavedEntries(커서)', () => api.listSavedEntries('c/3'),
    { method: 'get', path: '/v2/me/saved-entries?cursor=c%2F3' }, { body: sample('SavedChallengeEntries') }],
  ['listMyChallengeEntries', () => api.listMyChallengeEntries(),
    { method: 'get', path: '/v2/me/challenge-entries' }, { body: sample('MyChallengeEntries') }],
  ['listMyChallengeEntries(분류·커서)', () => api.listMyChallengeEntries('under_review', 'c-4'),
    { method: 'get', path: '/v2/me/challenge-entries?visibility=under_review&cursor=c-4' }, { body: sample('MyChallengeEntries') }],
  ['listChallenges(검색어·커서)', () => api.listChallenges({ tab: 'latest', q: '갈매기', cursor: 'c-5' }),
    { method: 'get', path: '/v2/challenges?tab=latest&q=%EA%B0%88%EB%A7%A4%EA%B8%B0&cursor=c-5' }, { body: sample('ChallengeList') }],
  ['listChallengeEntries(커서)', () => api.listChallengeEntries(id(50), { sort: 'recent', cursor: 'c-6' }),
    { method: 'get', path: `/v2/challenges/${id(50)}/entries?sort=recent&cursor=c-6` }, { body: sample('ChallengeEntryPage') }],
  ['listComments(커서)', () => api.listComments(id(51), 'c 7'),
    { method: 'get', path: `/v2/entries/${id(51)}/comments?cursor=c%207` }, { body: sample('EntryCommentPage') }],
  ['saveEntry(저장 취소)', () => api.saveEntry(id(51), false),
    { method: 'delete', path: `/v2/entries/${id(51)}/save` }, { body: { saved: false } }],
  ['continueConversation', () => api.continueConversation(id(60), 4),
    { method: 'post', path: `/v2/coach/conversations/${id(60)}/continue`, body: { revision: 4 } },
    { body: sample('CoachTurnResult') }],
  ['continueConversation(revision 없음)', () => api.continueConversation(id(60), null),
    { method: 'post', path: `/v2/coach/conversations/${id(60)}/continue`, body: { revision: null } },
    { body: sample('CoachTurnResult') }],
  ['auditions', () => api.auditions(),
    { method: 'get', path: '/v2/auditions', auth: false }, { body: sample('AuditionPostingList') }],
];

for (const [name, call, sent, reply] of CASES) {
  test(`api.${name}: ${sent.method.toUpperCase()} ${sent.path.split('?')[0]} 로 보내고 서버 답을 그대로 돌려준다`, async t => {
    const calls = httpResponses(t, [{ status: reply.status ?? 200, body: reply.body }]);
    const result = await call();

    assert.equal(calls.length, 1);
    const [request] = calls;
    const url = new URL(request.url);
    assert.equal(request.method, sent.method);
    assert.equal(url.pathname + url.search, sent.path);
    assert.deepEqual(request.body, sent.body ?? null);
    assert.equal(request.headers.get('Authorization'), sent.auth === false ? null : `Bearer ${ACCESS}`);
    if (sent.requestId) assert.equal(request.headers.get('X-Request-Id'), sent.requestId);
    assert.deepEqual(result, reply.status === 204 ? undefined : reply.body);
  });
}

test('api.recordConsent: 문서 결정을 요청 id 와 함께 보낸다', async t => {
  const calls = httpResponses(t, [{ status: 201, body: sample('ConsentEventResponse') }]);
  await api.recordConsent(id(4), 'declined');
  assert.equal(calls[0].method, 'post');
  assert.equal(calls[0].path, '/v2/consents');
  assert.deepEqual(calls[0].body, { document_id: id(4), action: 'declined' });
  assert.match(calls[0].headers.get('X-Request-Id'), UUID);
});

const admissionsPayload = {
  updated_at: '2026-10-01',
  disclaimer: '모집요강을 꼭 확인하세요.',
  universities: [{ id: 'snu', name: '서울대', admission_url: 'https://snu.test' }],
  notices: [{ id: 'snu-2027', university_id: 'snu' }],
};
const normalizedAdmissions = {
  ...admissionsPayload,
  universities: [{ id: 'snu', name: '서울대', admission_url: 'https://snu.test', resources: [], tips: [] }],
  notices: [{
    id: 'snu-2027', university_id: 'snu',
    designated_works: [], essay_questions: [], stages: [], practical_items: [], results: [],
  }],
};

test('api.admissions: 로그인 없이 읽고 빠진 목록 칸을 빈 목록으로 채운다', async t => {
  const calls = httpResponses(t, [{ body: admissionsPayload }]);
  assert.deepEqual(await api.admissions(), normalizedAdmissions);
  assert.equal(calls[0].path, '/v2/admissions');
  assert.equal(calls[0].headers.get('Authorization'), null);
});

test('api.admissionsByUniversity: 대학 하나만 로그인 없이 읽고 같은 정규화를 거친다', async t => {
  const calls = httpResponses(t, [{ body: admissionsPayload }]);
  assert.deepEqual(await api.admissionsByUniversity('snu/arts'), normalizedAdmissions);
  assert.equal(new URL(calls[0].url).pathname, '/v2/admissions/snu%2Farts');
  assert.equal(calls[0].headers.get('Authorization'), null);
});

test('api.getPractice: 영상 파일이 파기됐으면 재생 주소 없이 파기 표시만 한다', async t => {
  httpResponses(t, [
    { body: practice() },
    { body: video({ purged_at: '2026-10-01T00:00:00Z', playback_url: null, playback_expires_at: null }) },
  ]);
  const detail = await api.getPractice(id(1));
  assert.equal(detail.playback_url, null);
  assert.equal(detail.video_purged, true);
});

test('api.getPractice: 영상 조회가 실패해도 장면·노트는 열리고 재생만 비운다', async t => {
  const calls = httpResponses(t, [{ body: practice() }, { status: 404, body: { detail: 'video_not_found' } }]);
  const detail = await api.getPractice(id(1));
  assert.deepEqual(detail.scene, { situation: '이별 직후', character: '친구', goal: '붙잡기' });
  assert.equal(detail.playback_url, null);
  assert.equal(detail.video_purged, false);
  assert.deepEqual(calls.map(c => c.path), [`/v2/practices/${id(1)}`, `/v2/videos/${id(2)}`]);
});

test('api.getPractice: 영상이 없는 회차는 보관함을 묻지 않는다', async t => {
  const calls = httpResponses(t, [{ body: practice({ video_id: null }) }]);
  const detail = await api.getPractice(id(1));
  assert.equal(detail.playback_url, null);
  assert.equal(calls.length, 1);
});

test('api.getPracticeGroup: 목록에 없는 묶음은 practice_not_found 404', async t => {
  httpResponses(t, [{ body: { groups: [] } }]);
  await assert.rejects(api.getPracticeGroup(id(99)), {
    name: 'ApiError',
    status: 404,
    code: 'practice_not_found',
    message: '연습 기록을 불러오지 못했어요.',
  });
});
