import assert from 'node:assert/strict';
import test from 'node:test';
import { api, httpResponses, id, practice, video } from './helpers/practice-api.mjs';
import { analysisRecoveryAction, watchAnalysis } from '../lib/practice/analysis-run.ts';
import { groupTitle, roundSummary } from '../lib/practice/groups.ts';
import { noteKindLabel, noteSections, quoteSourceLabel, readOptionalPracticeNote } from '../lib/practice/note.ts';
import { writtenByLabel } from '../lib/practice/memory.ts';
import { videoPlaybackSource } from '../lib/library/library-view.ts';
import { buildContinueBody, buildStartBody, emptyBlockageDraft, emptySceneDraft } from '../lib/practice/start.ts';
import { buildFeedbackBody, shouldOfferFeedback } from '../lib/practice/feedback.ts';
import { buildNoteRatingBody } from '../lib/practice/note-rating.ts';
import { buildReplyBody, coachFailure, coachFailureMessage, isClosed, loadCoachSession, orderedMessages, remainingCoachReplies } from '../lib/practice/coach.ts';
import { videoErrorMessage } from '../lib/library/video-checks.ts';

test('서버 상태 응답의 partial 분석은 작업 장부가 없어도 대화로 진행한다', async t => {
  httpResponses(t, [{ body: { stage: 'conversing', close_reason: null, analysis_status: 'partial', job: null } }]);
  const result = await watchAnalysis(id(1), new AbortController().signal, {
    getStatus: (key, signal) => api.getPracticeStatus(key, { signal }),
    delay: async () => { throw new Error('completed analysis must not wait'); },
  });
  assert.deepEqual(result, { kind: 'ready', analysis: 'partial' });
});

test('요청 본문 불일치는 글자 수 초과나 업로드 만료로 표시하지 않는다', async t => {
  httpResponses(t, [{ status: 422, body: { detail: 'request_fingerprint_mismatch' } }]);
  const error = await api.replyToCoach({ conversation_id: id(5), request_id: id(9), text: '답', revision: 1 }).catch(error => error);
  assert.equal(coachFailureMessage(coachFailure(error)), '요청 내용이 바뀌었어요. 다시 보내 주세요.');
  assert.equal(videoErrorMessage(error), '요청 내용이 바뀌었어요. 다시 보내 주세요.');
});

test('영상만 시작·같은 영상 이어하기는 서버 본문과 경험 헤더를 그대로 사용한다', async t => {
  const calls = httpResponses(t, [{ status: 201, body: practice() }, { status: 201, body: practice({ ordinal: 2 }) }]);
  await api.createPractice(buildStartBody({ requestId: id(9), videoId: id(2), scene: emptySceneDraft, blockage: emptyBlockageDraft }));
  await api.continuePractice(id(1), buildContinueBody({ requestId: id(10), videoId: null, scene: emptySceneDraft, blockage: emptyBlockageDraft }));
  assert.deepEqual(calls[0].body.scene, { situation: '', character: '', goal: '' });
  assert.deepEqual(calls[0].body.blockage, { category: '그 외', detail: '그 외', note: null });
  assert.equal(calls[1].body.video_id, undefined);
  for (const call of calls) {
    assert.equal(call.headers.get('X-Acttub-Contract'), 'three_layers_v1');
    assert.equal(call.headers.get('X-Request-Id'), call.body.request_id);
  }
});

test('코치 시작·답장·재조회는 messages와 revision·close_reason을 보존한다', async t => {
  const initial = { id: id(5), practice_id: null, status: 'open', close_reason: null, revision: 1, coach_reply_count: 1, reply_limit: 10,
    messages: [{ turn_index: 0, role: 'coach', text: '무엇을 기다리고 있었나요?', created_at: null }], created_at: null };
  const closed = { ...initial, status: 'closed', close_reason: 'user_ended', revision: 2, coach_reply_count: 2,
    messages: [...initial.messages, { turn_index: 1, role: 'actor', text: '그만', created_at: null }, { turn_index: 2, role: 'coach', text: '여기까지 나눠요', created_at: null }] };
  const calls = httpResponses(t, [
    { body: { conversation: initial, message: initial.messages[0].text, note: null } },
    { body: { conversation: closed, message: '여기까지 나눠요', note: null } },
    { body: { ...closed, practice_id: id(1) } },
  ]);
  const start = await api.startConversation(id(1), id(9));
  assert.equal(remainingCoachReplies(start.conversation), 9);
  const result = await api.replyToCoach(buildReplyBody({ conversation: start.conversation, requestId: id(10), text: '그만' }));
  assert.equal(isClosed(result.conversation), true);
  assert.equal(calls[1].body.revision, 1);
  const latest = await api.getConversation(id(5));
  assert.equal(latest.close_reason, 'user_ended');
  assert.deepEqual(orderedMessages(latest).map(m => m.text), ['무엇을 기다리고 있었나요?', '그만', '여기까지 나눠요']);
});

test('설문은 asked_now 선점 결과로 열고 건너뛰기·재전송 본문을 서버 계약으로 보낸다', async t => {
  const calls = httpResponses(t, [
    { body: { asked: true, asked_now: true } },
    { status: 201, body: { id: id(12) } },
    { status: 200, body: { id: id(12) } },
    { body: { asked: true, asked_now: false } },
  ]);
  const first = await api.claimFeedbackAsk();
  assert.equal(shouldOfferFeedback({ online: true, claimedNow: first.asked_now }), true);
  const body = buildFeedbackBody({ requestId: id(9), practiceId: id(1), screen: 'report', trigger: 'back' });
  const created = await api.submitPracticeFeedback(body);
  const retried = await api.submitPracticeFeedback(body);
  assert.equal(created.id, retried.id);
  assert.equal(calls[1].body.body, undefined);
  assert.equal(calls[1].body.contact_email, undefined);
  const next = await api.claimFeedbackAsk();
  assert.equal(shouldOfferFeedback({ online: true, claimedNow: next.asked_now }), false);
});

test('조회 오류는 재조회하고 실패한 분석만 새 작업으로 재시도한다', () => {
  assert.equal(analysisRecoveryAction(null), 'reload');
  assert.equal(analysisRecoveryAction({ stage: 'analyzing', job: { status: 'running' }, analysis_status: null }), 'reload');
  assert.equal(analysisRecoveryAction({ stage: 'closed', job: { status: 'failed', failure_reason: 'timeout' }, analysis_status: null }), 'reanalyze');
  assert.equal(analysisRecoveryAction({ stage: 'closed', job: { status: 'failed', failure_reason: 'cancelled' }, analysis_status: null }), 'none');
});

test('노트 없음은 note_not_found만이며 조회 실패를 짧은 대화로 표시하지 않는다', async t => {
  httpResponses(t, [
    { status: 404, body: { detail: 'note_not_found' } },
    { status: 503, body: { detail: 'temporarily_unavailable' } },
  ]);
  assert.equal(await readOptionalPracticeNote(api.getPracticeNote, id(1)), null);
  await assert.rejects(readOptionalPracticeNote(api.getPracticeNote, id(1)), error => error.status === 503);
});

test('파일 파기 뒤에는 기기 복사본이 있어도 보관함에서 재생하지 않는다', async t => {
  httpResponses(t, [{ body: video({ purged_at: '2026-09-22T02:00:00Z', playback_url: null }) }]);
  const purged = await api.getVideo(id(2));
  assert.equal(videoPlaybackSource(purged, 'file:///local-copy.mp4'), null);
});

test('보관함 다음 쪽은 서버의 불투명 커서를 그대로 보내고 201·200 확정을 모두 받는다', async t => {
  const calls = httpResponses(t, [
    { body: { videos: [video()], next_cursor: null } },
    { status: 201, body: video() }, { status: 200, body: video() },
  ]);
  await api.listVideos('favorite', '2026-09-21T02:00:00Z|video+id');
  const first = await api.completeVideoIntent(id(7), id(9));
  const replay = await api.completeVideoIntent(id(7), id(9));
  assert.equal(new URL(calls[0].url).searchParams.get('cursor'), '2026-09-21T02:00:00Z|video+id');
  assert.equal(first.id, replay.id);
});

test('앱 재진입 때 닫힌 대화는 다시 시작하지 않고 마지막 메시지와 종료 사유를 읽는다', async t => {
  httpResponses(t, [
    { body: practice({ stage: 'closed', conversation_id: id(5), conversation_status: 'closed' }) },
    { body: video({ purged_at: '2026-09-22T02:00:00Z', playback_url: null }) },
    { body: { id: id(5), practice_id: id(1), status: 'closed', close_reason: 'system_failure', revision: 4, coach_reply_count: 2, reply_limit: 10,
      messages: [{ turn_index: 1, role: 'coach', text: '오늘은 여기까지예요', created_at: null }], created_at: null } },
    { status: 404, body: { detail: 'note_not_found' } },
  ]);
  const result = await loadCoachSession(api, id(1), id(9));
  assert.equal(result.conversation.close_reason, 'system_failure');
  assert.equal(result.conversation.messages[0].text, '오늘은 여기까지예요');
  assert.equal(result.note, null);
});

test('완료된 대화의 회차로 돌아오면 분석을 실패로 바꾸지 않고 저장된 결과로 진행한다', async t => {
  httpResponses(t, [{ body: { stage: 'closed', close_reason: 'conversation_closed', analysis_status: 'ready', job: null } }]);
  const result = await watchAnalysis(id(1), new AbortController().signal, {
    getStatus: key => api.getPracticeStatus(key), delay: async () => { throw new Error('no polling'); },
  });
  assert.deepEqual(result, { kind: 'ready', analysis: 'ready' });
});

test('저장한 배우 기억의 written_by_actor로 내가 적은 값을 표시한다', async t => {
  httpResponses(t, [{ body: { field: 'goal', value: '상대에게 전하기', written_by_actor: true, source_practice_id: null, updated_at: '2026-09-21T02:00:00Z' } }]);
  const memory = await api.saveActorMemory('goal', '상대에게 전하기');
  assert.equal(writtenByLabel(memory), '내가 적은 값');
});

test('legacy 노트 봉투가 비어 있어도 원문 배우 발견과 촬영 제안을 보여준다', async t => {
  httpResponses(t, [{ body: {
    id: id(6), conversation_id: id(5), format: 'legacy', kind: 'analysis', title: '기다리는 시선',
    summary_quotes: [], next_take: null, actor_words: [], corrections: [], tags: [], fallback: false,
    source_revision: 3, created_at: '2026-09-21T02:00:00Z',
    report: { report_type: 'analysis', title: '기다리는 시선', actor_discovery: '눈을 피하고 있었어요', next_take: { direction: '상대를 보며 한 번 더 찍기', tested: false },
      line_meaning: '붙잡기', timing_reason: '대답을 기다린 뒤', target_effect: '곁에 남기', acting_caution: '서두르지 않기', evidence: [], uncertainties: [], source_handoff_id: id(5) },
  } }]);
  const note = await api.getPracticeNote(id(1));
  const [summary, next] = noteSections(note);
  assert.equal(summary.text, '눈을 피하고 있었어요');
  assert.equal(next.text, '상대를 보며 한 번 더 찍기');
  assert.equal(noteKindLabel(note.kind), '장면 분석');
});

test('서버 노트의 quote·kind·source_ref와 공개 촬영 제안을 표시한다', async t => {
  httpResponses(t, [{ body: {
    id: id(6), conversation_id: id(5), format: 'v2', kind: 'action', title: '기다리는 시선',
    summary_quotes: [{ quote: '기다리고 있었어요', kind: 'actor', source_ref: 'actor:2' }],
    next_take: '상대를 붙잡고 싶어요', actor_words: [], corrections: [], tags: [], fallback: false,
    source_revision: 3, created_at: '2026-09-21T02:00:00Z',
    report: { schema_version: 'acttub.public_practice_note.v1', report_type: 'practice_note', note_id: id(6), revision: 3,
      title: '기다리는 시선', summary: '기다리고 있었어요', mode: 'action', end_reason: 'actor_finished', lifecycle: 'saved',
      record_ref: null, direction: null, focus: null, reading: null,
      practice: { proposal_id: 'proposal:1', selection: 'proposed', instruction: '대사가 끝나도 시선을 두고 찍어보세요', comparison: '시선이 머무는지', keep: null },
      attempts: [], open_points: [], evidence: [] },
  } }]);
  const note = await api.getPracticeNote(id(1));
  const [summary, next, cheer] = noteSections(note);
  assert.equal(summary.quotes[0].quote, '기다리고 있었어요');
  assert.equal(quoteSourceLabel(summary.quotes[0].kind), '배우님 말');
  assert.equal(next.text, '대사가 끝나도 시선을 두고 찍어보세요');
  assert.equal(cheer.text, '오늘 촬영도 수고했어요. 다음 촬영도 응원할게요.');
});

test('묶음 상세는 실제 목록 계약으로 제목·회차·이전 대화를 구성한다', async t => {
  httpResponses(t, [{ path: '/v2/practices', body: { groups: [{
    root_id: id(1), title: null, ordinal_count: 2, last_conversation_at: null,
    tags: ['시선'], favorite: false, hidden_at: null, in_progress_practice_id: null,
    practices: [practice({ id: id(4), ordinal: 2, note_id: id(6), note_title: '시선을 들기', note_kind: 'action', conversation_count: 5, created_at: '2026-09-22T02:00:00Z' }),
      practice({ previous_conversations: [{ id: id(8), status: 'closed', created_at: '2026-09-21T02:00:00Z' }] })],
  }] } }]);
  const group = await api.getPracticeGroup(id(1));
  assert.equal(groupTitle(group), '시선을 들기');
  assert.equal(group.last_practiced_at, '2026-09-22T02:00:00Z');
  assert.deepEqual(group.practices.map(p => p.ordinal), [1, 2]);
  assert.equal(group.practices[0].previous_conversations[0].id, id(8));
  assert.match(roundSummary(group.practices[1]), /5/);
  assert.equal(group.video_id, id(2));
});

test('회차 상세의 평평한 장면과 보관함 재생 주소가 대화 화면으로 이어진다', async t => {
  httpResponses(t, [{ body: practice() }, { body: video() }]);
  const detail = await api.getPractice(id(1));
  assert.deepEqual(detail.scene, { situation: '이별 직후', character: '친구', goal: '붙잡기' });
  assert.deepEqual(detail.blockage, { category: '그 외', detail: '그 외', note: null });
  assert.equal(detail.playback_url, 'https://storage.test/signed.mp4');
});

test('분석 재시도는 서버 필수 본문과 헤더에 같은 request_id를 보낸다', async t => {
  const calls = httpResponses(t, [{ status: 201, body: practice({ stage: 'analyzing', analysis_status: null }) }]);
  await api.retryPracticeAnalysis(id(1));
  assert.equal(calls[0].body.request_id, calls[0].headers.get('X-Request-Id'));
});

test('명시한 분석 재시도 요청 id를 본문과 재전송에서 유지한다', async t => {
  const calls = httpResponses(t, [{ status: 201, body: practice() }, { status: 201, body: practice() }]);
  await api.retryPracticeAnalysis(id(1), { requestId: id(11) });
  await api.retryPracticeAnalysis(id(1), { requestId: id(11) });
  assert.equal(calls[0].body.request_id, id(11));
  assert.equal(calls[1].body.request_id, id(11));
});

test('노트 평가는 PUT 한 번에 저장하고 노트 조회의 my_rating 이 초기값이 된다', async t => {
  const saved = { rating: 'helpful', comment: '시선 얘기가 좋았어요', updated_at: '2026-09-24T00:00:00.000000Z' };
  const calls = httpResponses(t, [
    { status: 200, body: saved },
    { body: {
      id: id(6), conversation_id: id(5), format: 'v2', kind: 'action', title: '기다리는 시선',
      summary_quotes: [], next_take: null, actor_words: [], corrections: [], tags: [], fallback: false,
      source_revision: 3, created_at: '2026-09-21T02:00:00Z', report: null, my_rating: saved,
    } },
  ]);
  const body = buildNoteRatingBody({ requestId: id(9), rating: 'helpful', comment: '  시선 얘기가 좋았어요 ' });
  const result = await api.putNoteRating(id(1), body);
  assert.deepEqual(result, saved);
  assert.equal(calls[0].method, 'put');
  assert.equal(calls[0].path, `/v2/practices/${id(1)}/note/rating`);
  assert.deepEqual(calls[0].body, { request_id: id(9), rating: 'helpful', comment: '시선 얘기가 좋았어요' });
  const note = await api.getPracticeNote(id(1));
  assert.deepEqual(note.my_rating, saved);
});
