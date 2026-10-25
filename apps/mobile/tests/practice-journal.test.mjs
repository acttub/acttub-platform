import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  EMPTY_DRAFT,
  buildAnswers,
  buildUpdate,
  canAnswer,
  editOf,
  journalMeta,
  journalNext,
  journalQuestions,
  journalSummary,
  journalTitle,
  preview,
  readOptionalJournal,
  timeLabel,
} from '../lib/practice/journal.ts';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const fixture = JSON.parse(read('tests/fixtures/journal-v4-video.input.json'));

/** 10/19 v4 가상 대화(fixtures/v4-video)의 배우 답과 서버 결과(results/v4)로 만든 일지. */
function journal(overrides = {}) {
  return {
    id: 'j1',
    practice_id: 'p1',
    conversation_id: 'c1',
    answers: fixture.answers.feeling
      ? {
          feeling: fixture.answers.feeling,
          unknown: fixture.answers.unknown,
          next: fixture.answers.next,
          review: fixture.answers.review,
        }
      : null,
    draft_status: 'ready',
    practice: [{ text: '「가지 마」 대사를 소리 지르지 않고 상대 눈을 보며 낮게 말해 봤어요', basis: 'actor_report' }],
    character: [
      { aspect: 'wants', text: '상대가 떠나지 않고 이야기를 끝까지 들어주기' },
      { aspect: 'partner', text: '연인' },
    ],
    feedback: [{ text: '「가지 마」 직전에 상대를 2초 정도 바라보는 모습이에요', giver: 'coach', at: 42 }],
    edited_at: null,
    created_at: '2026-10-23T03:00:00Z',
    updated_at: '2026-10-23T03:00:00Z',
    title: '「가지 마」 장면',
    purpose: 'evaluate',
    role_name: '은서',
    ...overrides,
  };
}

test('고정 질문 4개는 순서·문구가 늘 같고 선택지는 10/19 questions.json 그대로다', () => {
  const questions = journalQuestions();
  assert.deepEqual(questions.map((q) => q.title), [
    '해 보니 어땠어요?',
    '아직 헷갈리거나 궁금한 게 있어요?',
    '다음엔 뭘 해 볼래요?',
    '오늘 연습을 한 줄로 남긴다면?',
  ]);
  assert.deepEqual(questions[0].choices.map((c) => c.label), ['편했어요', '떨렸어요', '어색했어요', '잘 모르겠어요']);
  assert.deepEqual(questions[1].choices.map((c) => c.label), ['없어요']);
  assert.deepEqual(questions[2].choices.map((c) => c.label), ['아직 안 정했어요']);
  assert.deepEqual(questions[3].choices, []);
});

test('고르거나 쓴 게 있어야 「다음」, 건너뛴 질문은 null, 글은 앞뒤 공백만 걷는다', () => {
  assert.equal(canAnswer(EMPTY_DRAFT), false);
  assert.equal(canAnswer({ choice: null, text: '  ' }), false);
  assert.equal(canAnswer({ choice: 'nervous', text: '' }), true);
  const answers = buildAnswers({
    feeling: { choice: '떨렸어요', text: '  낮게 하니까 오히려 더 떨렸어요 ' },
    unknown: { choice: 'none', text: '' },
    next: EMPTY_DRAFT,
    review: { choice: null, text: fixture.answers.review },
  });
  assert.deepEqual(answers, {
    feeling: { choice: '떨렸어요', text: '낮게 하니까 오히려 더 떨렸어요' },
    unknown: { none: true, text: null },
    next: null,
    review: fixture.answers.review,
  });
});

test('요약형: 위 상자(후기·느낌·모르는 것 개수), 다음에 해 볼 것, 한 줄 미리보기 목록 — 배우 답은 그대로', () => {
  const summary = journalSummary(journal());
  assert.equal(summary.review, fixture.answers.review);
  assert.equal(summary.feelingTag, '떨렸어요');
  assert.equal(summary.unknownCount, 1);
  assert.equal(summary.next, fixture.answers.next.text);
  assert.deepEqual(summary.rows.map((r) => r.label), ['액티가 본 장면', '오늘 한 연습', '해 보니', '장면과 인물', '아직 모르는 것']);
  assert.equal(summary.rows[0].lines[0].prefix, '▶ 0:42');
  assert.match(summary.rows[0].preview, /^▶ 0:42 · /);
  assert.equal(summary.rows[2].lines[0].text, '떨렸어요 · 낮게 하니까 오히려 더 떨렸어요');
  assert.equal(summary.rows[4].lines[0].text, fixture.answers.unknown.text);
});

test('빈 칸은 숨긴다 — 건너뛴 질문, 「없어요」·「아직 안 정했어요」, 근거 없어 빈 AI 칸', () => {
  const summary = journalSummary(journal({
    answers: { feeling: null, unknown: { none: true, text: null }, next: { undecided: true, text: null }, review: null },
    practice: [],
    character: [],
    feedback: [],
    draft_status: 'failed',
  }));
  assert.deepEqual(summary, { review: null, feelingTag: null, unknownCount: 0, next: null, rows: [] });
});

test('인물 이해하기는 장면과 인물이 맨 위다(pen ⓒ3 메모)', () => {
  assert.equal(journalSummary(journal({ purpose: 'character' })).rows[0].key, 'character');
});

test('머리 줄·제목 — 장면 이름이 없으면 목적·날짜', () => {
  assert.equal(journalMeta(journal()), '10월 23일 · 은서 역 · 평가 받기');
  assert.equal(journalMeta(journal({ role_name: null, purpose: null })), '10월 23일');
  assert.equal(journalTitle(journal()), '「가지 마」 장면');
  assert.equal(journalTitle(journal({ title: null, purpose: 'stuck' })), '막힌 곳 풀기 · 10월 23일');
});

test('미리보기는 앞 글자 뒤 말줄임, 영상 시간은 ▶ m:ss', () => {
  assert.equal(preview('짧은 글'), '짧은 글');
  assert.equal(preview('가나다라마바사아자차카타파하거너', 5), '가나다라마…');
  assert.equal(timeLabel(31), '▶ 0:31');
  assert.equal(timeLabel(125.9), '▶ 2:05');
});

test('편집 — 고친 글만 바꾸고 고른 칩은 둔다, 질문 3에 글을 쓰면 「아직 안 정했어요」가 풀린다', () => {
  const base = journal({ answers: { ...journal().answers, next: { undecided: true, text: null } } });
  const edit = { ...editOf(base), review: ' 고친 후기 ', next: '준호를 보며 말하기', practice: ['고친 연습'], feedback: [''] };
  const body = buildUpdate(base, edit);
  assert.deepEqual(body.answers.feeling, { choice: '떨렸어요', text: '낮게 하니까 오히려 더 떨렸어요' });
  assert.deepEqual(body.answers.next, { undecided: false, text: '준호를 보며 말하기' });
  assert.equal(body.answers.review, '고친 후기');
  assert.deepEqual(body.practice, [{ text: '고친 연습', basis: 'actor_report' }]);
  assert.equal(body.feedback[0].text, '');
  assert.equal(body.feedback[0].at, 42);
  assert.equal(body.character.length, 2);
});

test('다음에 해 볼 것은 질문 3에 직접 쓴 글만 — 홈 숙제가 노트보다 먼저 쓴다', () => {
  assert.equal(journalNext(journal()), fixture.answers.next.text);
  assert.equal(journalNext(journal({ answers: { ...journal().answers, next: { undecided: true, text: null } } })), null);
  assert.equal(journalNext(null), null);
  const hook = read('hooks/use-next-takes.ts');
  assert.match(hook, /fromJournal \?\? fromNote/);
});

test('일지가 없으면(404 journal_not_found) null, 다른 실패는 던진다', async () => {
  assert.equal(await readOptionalJournal(async () => { throw Object.assign(new Error('x'), { code: 'journal_not_found' }); }, 'p1'), null);
  await assert.rejects(readOptionalJournal(async () => { throw Object.assign(new Error('x'), { code: 'network' }); }, 'p1'));
});

test('코칭이 끝나면 배우 일지로 간다 — coach.tsx 는 연결 한 줄만, 튜토리얼 예시는 미리 쓴 노트 그대로', () => {
  const coach = read('app/coach.tsx');
  assert.match(coach, /router\.replace\(sample \? '\/report' : '\/journal'\)/);
  const ko = read('locales/ko.ts');
  assert.match(ko, /seeSummary: '일지 쓰고 마치기'/);
  // 「배우일지로 남길까요?」 확인 창은 두지 않는다.
  assert.doesNotMatch(read('app/journal.tsx'), /배우일지로 남길까요/);
});

test('느낌 칩은 키(easy)로 저장하고, 일지에는 고른 말(편했어요)로 보인다(SOMA-822)', () => {
  // 폰 확인(10/24): 「편했어요」를 고르면 일지 위 상자와 「해 보니」 줄에 easy 가 그대로 떴다.
  const answers = buildAnswers({
    feeling: { choice: 'easy', text: '' },
    unknown: EMPTY_DRAFT,
    next: EMPTY_DRAFT,
    review: EMPTY_DRAFT,
  });
  assert.deepEqual(answers.feeling, { choice: 'easy', text: null });
  const saved = journalSummary(journal({ answers: { ...fixture.answers, feeling: { choice: 'easy', text: null } } }));
  assert.equal(saved.feelingTag, '편했어요');
  assert.equal(saved.rows.find((r) => r.key === 'feeling').lines[0].text, '편했어요');
});
