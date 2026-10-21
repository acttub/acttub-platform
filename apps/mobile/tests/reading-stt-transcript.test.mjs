import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { EMPTY_TRANSCRIPT, addResult, transcriptText } from '../lib/reading/stt-transcript.ts';

const feed = (events) => transcriptText(events.reduce((s, [t, fin]) => addResult(s, t, fin), EMPTY_TRANSCRIPT));

test('stt-transcript: Android 연속 인식 — 확정 조각마다 새 조각만 와도 줄 전체가 남는다(SOMA-606)', () => {
  assert.equal(
    feed([
      ['돼지 목에', false], ['돼지 목에 진주 목걸이', false], ['돼지 목에 진주 목걸이', true],
      ['네', false], ['네', true],
      ['지금 뭐', false], ['지금 뭐 하시는 거예요', false], ['지금 뭐 하시는 거예요', true],
    ]),
    '돼지 목에 진주 목걸이 네 지금 뭐 하시는 거예요',
  );
});

test('stt-transcript: iOS 누적 결과 — 앞 조각을 다시 담아 보내도 겹치지 않는다', () => {
  assert.equal(
    feed([['얼굴', false], ['얼굴 예쁜 여자', false], ['얼굴 예쁜 여자 진짜 별론데', false], ['얼굴 예쁜 여자 진짜 별론데', true]]),
    '얼굴 예쁜 여자 진짜 별론데',
  );
  assert.equal(feed([['얼굴 예쁜 여자', true], ['얼굴 예쁜 여자 진짜 별론데', true]]), '얼굴 예쁜 여자 진짜 별론데');
});

test('stt-transcript: 확정 없이 새로 시작한 중간 결과는 앞 결과를 지우지 않는다', () => {
  assert.equal(
    feed([['어른답게 행동하세요', false], ['지금', false], ['지금 잘 참고 있으니까', false]]),
    '어른답게 행동하세요 지금 잘 참고 있으니까',
  );
});

test('stt-transcript: 인식기가 앞 단어를 고쳐 쓰는 중간 결과는 새 조각으로 보지 않는다', () => {
  assert.equal(feed([['만나서 반가', false], ['만나서 반갑습니다', false]]), '만나서 반갑습니다');
  assert.equal(feed([['만나서 반갑습니다', false], ['만나서 반갑습니다', true]]), '만나서 반갑습니다');
});

test('stt-transcript: 빈 결과는 무시하고, 빈 확정은 남은 중간 결과를 확정한다', () => {
  assert.equal(feed([['', false], ['네', false], ['', true]]), '네');
  assert.equal(feed([]), '');
});

test('reading.stt: 훅은 마지막 결과로 덮어쓰지 않고 이어 붙인 글을 쓴다(SOMA-606)', () => {
  const hook = readFileSync(new URL('../hooks/use-reading-stt.ts', import.meta.url), 'utf8');
  const handler = hook.slice(hook.indexOf("useSpeechRecognitionEvent('result'"), hook.indexOf("useSpeechRecognitionEvent('volumechange'"));
  assert.match(handler, /addResult\(pieces\.current, transcript, !!event\.isFinal\)/);
  assert.doesNotMatch(handler, /text\.current = transcript;/);
  assert.match(hook, /pieces\.current = EMPTY_TRANSCRIPT;/, '새 줄을 들을 때 앞 줄 조각을 비운다');
});
