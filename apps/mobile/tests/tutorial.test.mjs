import assert from 'node:assert/strict';
import test from 'node:test';

import { TARGET } from '../lib/spotlight-targets.ts';
import {
  currentTutorial,
  endTutorial,
  onTutorialChanged,
  READING_TUTORIAL_STAGES,
  stageTrack,
  startTutorial,
  tutorialSteps,
  TUTORIAL_STAGES,
} from '../lib/tutorial.ts';
import {
  createSampleLoop,
  isSamplePracticeId,
  SAMPLE_ANALYZING_STEP_MS,
  SAMPLE_PRACTICE_ID,
  sampleAnswerFor,
  sampleDetail,
  sampleScene,
} from '../lib/tutorial-sample.ts';
import {
  buildReplyBody,
  COACH_END_WORD,
  isClosed,
  loadCoachSession,
  orderedMessages,
} from '../lib/practice/coach.ts';
import ko from '../locales/ko.ts';
import en from '../locales/en.ts';

/**
 * 연습 루프를 한 바퀴 돌아보는 튜토리얼 (SOMA-494).
 *
 * <p>화면은 실기기에서 본다. 여기서는 단계 규칙과, 예시 경로가 서버를 한 번도 부르지
 * 않는다는 것만 시험한다.
 */

test('시작하면 모드가 잡히고, 끝내면 비워진다', () => {
  startTutorial('sample');
  assert.deepEqual(currentTutorial(), { mode: 'sample', track: 'practice' });
  endTutorial();
  assert.equal(currentTutorial(), null);
});

test('시작·끝을 구독한 쪽에 알린다', () => {
  let calls = 0;
  const off = onTutorialChanged(() => {
    calls += 1;
  });
  startTutorial('own');
  endTutorial();
  endTutorial(); // 이미 끝났으면 다시 알리지 않는다
  off();
  startTutorial('own');
  endTutorial();
  assert.equal(calls, 2);
});

test('루프 네 화면 모두 비출 단계가 있고, 이름표는 모두 TARGET 에 있다', () => {
  const targets = new Set(Object.values(TARGET));
  for (const mode of ['own', 'sample']) {
    for (const stage of TUTORIAL_STAGES) {
      const steps = tutorialSteps(stage, mode);
      assert.ok(steps.length > 0, `${mode}/${stage} 단계가 비었다`);
      for (const step of steps) assert.ok(targets.has(step.target), step.target);
    }
  }
});

test('예시 경로엔 영상 고르기 안내가 없고, 내 영상 경로엔 있다', () => {
  const own = tutorialSteps('upload', 'own').map((s) => s.target);
  const sample = tutorialSteps('upload', 'sample').map((s) => s.target);
  assert.ok(own.includes(TARGET.uploadPick));
  assert.ok(!sample.includes(TARGET.uploadPick));
  assert.ok(sample.includes(TARGET.uploadSample));
});

test('단계 문구 키는 한국어·영어 둘 다 있다', () => {
  const read = (dict, key) => key.split('.').reduce((node, part) => node?.[part], dict);
  for (const mode of ['own', 'sample']) {
    for (const stage of TUTORIAL_STAGES) {
      for (const step of tutorialSteps(stage, mode)) {
        for (const dict of [ko, en]) {
          assert.equal(typeof read(dict, `${step.text}Title`), 'string', `${step.text}Title`);
          assert.equal(typeof read(dict, `${step.text}Body`), 'string', `${step.text}Body`);
        }
      }
    }
  }
});

test('예시 연습인지는 연습 id 로 가린다 — 실제 연습은 예시로 오인하지 않는다', () => {
  assert.equal(isSamplePracticeId(SAMPLE_PRACTICE_ID), true);
  assert.equal(isSamplePracticeId('a3b1c2d4-real'), false);
  assert.equal(isSamplePracticeId(null), false);
});

test('예시 장면은 세 칸이 다 차 있고, 회차 상세도 그 장면을 싣는다', () => {
  const scene = sampleScene();
  assert.ok(scene.situation.trim());
  assert.ok(scene.character.trim());
  assert.ok(scene.goal.trim());
  const detail = sampleDetail();
  assert.equal(detail.id, SAMPLE_PRACTICE_ID);
  assert.deepEqual(detail.scene, scene);
  assert.equal(detail.conversation_id, null);
});

test('예시 분석은 몇 초 안에 끝난다', () => {
  assert.ok(SAMPLE_ANALYZING_STEP_MS.length >= 2);
  const total = SAMPLE_ANALYZING_STEP_MS.reduce((a, b) => a + b, 0);
  assert.ok(total <= 6000, `${total}ms`);
});

/** 코치 화면이 하는 대로 — loadCoachSession 으로 열고 buildReplyBody 로 답한다. */
async function answer(loop, result, text) {
  return loop.replyToCoach(
    buildReplyBody({ conversation: result.conversation, requestId: `r-${text}`, text }),
  );
}

test('예시 코치는 질문 둘을 하고 대화를 닫으며 노트를 준다 — 네트워크는 0회', async () => {
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = () => {
    fetched += 1;
    throw new Error('예시 경로에서 네트워크를 불렀다');
  };
  try {
    const loop = createSampleLoop({ delayMs: 0 });
    const first = await loadCoachSession(loop, SAMPLE_PRACTICE_ID, 'start-1', null);
    assert.equal(first.conversation.status, 'open');
    assert.ok(first.message);
    assert.equal(orderedMessages(first.conversation).at(-1).role, 'coach');

    const second = await answer(loop, first, '대사를 빨리 끝내고 싶었어요');
    assert.equal(second.conversation.status, 'open');
    assert.ok(second.conversation.revision > first.conversation.revision);
    assert.notEqual(second.message, first.message);
    assert.deepEqual(
      orderedMessages(second.conversation).map((m) => m.role),
      ['coach', 'actor', 'coach'],
    );

    const last = await answer(loop, second, '멈춘 뒤에 말해 볼게요');
    assert.equal(isClosed(last.conversation), true);
    assert.ok(last.note);
    assert.ok(last.note.title);
    assert.ok(last.note.next_take);
    // 요약은 배우가 방금 한 말을 그대로 인용한다.
    assert.equal(last.note.summary_quotes[0].quote, '대사를 빨리 끝내고 싶었어요');
    assert.equal(last.note.summary_quotes[0].kind, 'actor');

    assert.deepEqual(await loop.getPracticeNote(SAMPLE_PRACTICE_ID), last.note);
    assert.equal(fetched, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('예시 코치는 "그만"으로 먼저 끝내도 대화를 닫고 노트를 준다', async () => {
  const loop = createSampleLoop({ delayMs: 0 });
  const first = await loadCoachSession(loop, SAMPLE_PRACTICE_ID, 'start-1', null);
  const end = await answer(loop, first, COACH_END_WORD);
  assert.equal(isClosed(end.conversation), true);
  assert.ok(end.note);
});

test('예시 대화를 다시 열면 같은 대화를 이어 간다 — 코치 화면 재진입', async () => {
  const loop = createSampleLoop({ delayMs: 0 });
  const first = await loadCoachSession(loop, SAMPLE_PRACTICE_ID, 'start-1', null);
  const again = await loadCoachSession(loop, SAMPLE_PRACTICE_ID, 'start-2', first.conversation.id);
  assert.equal(again.conversation.id, first.conversation.id);
  assert.equal(again.conversation.messages.length, first.conversation.messages.length);
});

test('예시 노트는 대화가 닫히기 전엔 없다', async () => {
  const loop = createSampleLoop({ delayMs: 0 });
  await assert.rejects(loop.getPracticeNote(SAMPLE_PRACTICE_ID), (e) => e.code === 'note_not_found');
});

test('예시 문구에 쓰면 안 되는 말이 없다', () => {
  const banned = /점수|평가|강점|약점|개선점|등급|레벨|score|grade|judge|weakness/i;
  const texts = [JSON.stringify(ko.tutorial), JSON.stringify(en.tutorial)];
  for (const text of texts) assert.doesNotMatch(text, banned);
});

// 대본 리딩도 같은 방식으로 한 바퀴 돈다(SOMA-494). 갈래가 다르면 서로의 화면을 비추지 않는다.
test('대본 리딩 갈래로 시작하면 갈래가 기록된다', () => {
  startTutorial('sample', 'reading');
  assert.deepEqual(currentTutorial(), { mode: 'sample', track: 'reading' });
  endTutorial();
});

test('화면 단계마다 갈래가 정해져 있다 — 연습 화면은 practice, 대본 화면은 reading', () => {
  for (const stage of TUTORIAL_STAGES) assert.equal(stageTrack(stage), 'practice');
  for (const stage of READING_TUTORIAL_STAGES) assert.equal(stageTrack(stage), 'reading');
});

test('대본 리딩 네 화면 모두 비출 단계가 있고, 문구는 한국어·영어 둘 다 있다', () => {
  const targets = new Set(Object.values(TARGET));
  const read = (dict, key) => key.split('.').reduce((node, part) => node?.[part], dict);
  for (const mode of ['own', 'sample']) {
    for (const stage of READING_TUTORIAL_STAGES) {
      const steps = tutorialSteps(stage, mode);
      assert.ok(steps.length > 0, `${mode}/${stage}`);
      for (const step of steps) {
        assert.ok(targets.has(step.target), step.target);
        for (const dict of [ko, en]) {
          assert.equal(typeof read(dict, `${step.text}Title`), 'string', `${step.text}Title`);
          assert.equal(typeof read(dict, `${step.text}Body`), 'string', `${step.text}Body`);
        }
      }
    }
  }
});

test('예시 대본 경로는 파일 넣기 대신 채워 둔 대본을 비춘다', () => {
  const own = tutorialSteps('readingNew', 'own').map((s) => s.target);
  const sample = tutorialSteps('readingNew', 'sample').map((s) => s.target);
  assert.ok(own.includes(TARGET.readingDrop));
  assert.ok(!sample.includes(TARGET.readingDrop));
  assert.ok(sample.includes(TARGET.readingText));
});

// 예시 튜토리얼은 답도 샘플로 채워 둔다 — 영상을 모르는 사람이 무엇을 적을지 막히지 않게(SOMA-494).
test('예시 코치의 질문마다 채워 둘 샘플 답이 있고, 질문이 끝나면 없다', () => {
  const first = sampleAnswerFor(0);
  const second = sampleAnswerFor(1);
  assert.ok(first && first.trim());
  assert.ok(second && second.trim());
  assert.notEqual(first, second);
  assert.equal(sampleAnswerFor(2), null);
  // 샘플 답은 답장 한도(300자) 안이다.
  assert.ok(first.length <= 300 && second.length <= 300);
});
