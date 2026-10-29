import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

import { DEFAULT_APP_CONFIG, getAppConfig, parseAppConfig, setAppConfig, subscribeAppConfig } from '../lib/app-config.ts';
import { EMPTY_RATING_STATE, recordEvent } from '../lib/app-rating.ts';
import { videoTooLong, videoTooShort } from '../lib/challenge/entry.ts';
import { isDuration } from '../lib/challenge/create.ts';
import { tipIndex, todayTip } from '../lib/home-today.ts';
import { saidEnough } from '../lib/reading/line-coverage.ts';
import { alignSentences } from '../lib/reading/monologue.ts';
import { DEFAULT_VAD, currentVad } from '../lib/reading/vad.ts';
import en from '../locales/en.ts';
import ko from '../locales/ko.ts';

// 서버가 내려주는 앱 설정(SOMA-939) — 기본값은 오늘 앱 값 그대로, 칸마다 검사, 쓰는 순간 읽는다.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

afterEach(() => setAppConfig(DEFAULT_APP_CONFIG));

const SERVER = {
  rating: { coach_every: 2, reading_every: 2, min_gap_days: 7, max_asks: 3 },
  reading: {
    vad_threshold: 0.015, silence_ms: 1800, min_speech_ms: 400, max_listen_ms: 60000,
    speech_end_grace_ms: 1300, advance_coverage: 0.9,
    monologue_pass: 0.72, monologue_missed_below: 0.3, monologue_next_at: 0.8, monologue_touch_min: 3,
  },
  cocreate: { emotions: ['서운함', '설렘', '분노', '슬픔', '긴장', '담담함'], situations: ['오랜만의 재회', '이별', '오디션 직전', '가족 다툼', '고백', '사과'] },
  home_tips: { ko: [...ko.home.tips], en: [...en.home.tips] },
  challenge: { entry_min_seconds: 3, entry_max_seconds: 60, durations_days: [7, 14] },
};

test('기본값은 오늘까지 앱에 박혀 있던 값과 같다', () => {
  assert.deepEqual(DEFAULT_APP_CONFIG.rating, { coachEvery: 2, readingEvery: 2, minGapDays: 7, maxAsks: 3 });
  assert.deepEqual(DEFAULT_APP_CONFIG.reading, {
    vadThreshold: 0.015, silenceMs: 1800, minSpeechMs: 400, maxListenMs: 60000,
    speechEndGraceMs: 1300, advanceCoverage: 0.9,
    monologuePass: 0.72, monologueMissedBelow: 0.3, monologueNextAt: 0.8, monologueTouchMin: 3,
  });
  assert.deepEqual(DEFAULT_APP_CONFIG.cocreate.emotions, ['서운함', '설렘', '분노', '슬픔', '긴장', '담담함']);
  assert.deepEqual(DEFAULT_APP_CONFIG.cocreate.situations, ['오랜만의 재회', '이별', '오디션 직전', '가족 다툼', '고백', '사과']);
  assert.deepEqual(DEFAULT_APP_CONFIG.homeTips.ko, ko.home.tips);
  assert.deepEqual(DEFAULT_APP_CONFIG.homeTips.en, en.home.tips);
  assert.equal(DEFAULT_APP_CONFIG.homeTips.ko.length, 7);
  assert.deepEqual(DEFAULT_APP_CONFIG.challenge, { entryMinSeconds: 3, entryMaxSeconds: 60, durationsDays: [7, 14] });
  assert.deepEqual(DEFAULT_VAD, { threshold: 0.015, silenceMs: 1800, minSpeechMs: 400, maxListenMs: 60000 });
  assert.equal(getAppConfig(), DEFAULT_APP_CONFIG, '받아 오기 전에는 기본값');
});

test('parseAppConfig: 서버 기본 응답은 기본값과 같다', () => {
  assert.deepEqual(parseAppConfig(SERVER), DEFAULT_APP_CONFIG);
});

test('parseAppConfig: 이상한 응답 전체는 던지지 않고 기본값', () => {
  for (const bad of [null, undefined, 42, 'x', [], { rating: 'no' }]) {
    assert.deepEqual(parseAppConfig(bad), DEFAULT_APP_CONFIG);
  }
});

test('parseAppConfig: 맞는 칸은 쓰고, 빠지거나 이상한 칸만 그 칸 기본값', () => {
  const c = parseAppConfig({
    rating: { coach_every: 5, reading_every: 0, min_gap_days: 'x', max_asks: 2.5 },
    reading: { vad_threshold: 0.02, silence_ms: -1, advance_coverage: 1.5, monologue_pass: 0.8, monologue_touch_min: Number.NaN },
    cocreate: { emotions: ['기쁨', '분노'], situations: ['고백', ''] },
    home_tips: { ko: ['팁 하나'], en: [] },
    challenge: { entry_min_seconds: 5, entry_max_seconds: 90, durations_days: [3, 0] },
  });
  assert.deepEqual(c.rating, { coachEvery: 5, readingEvery: 2, minGapDays: 7, maxAsks: 3 });
  assert.equal(c.reading.vadThreshold, 0.02);
  assert.equal(c.reading.silenceMs, 1800);
  assert.equal(c.reading.minSpeechMs, 400, '빠진 칸');
  assert.equal(c.reading.advanceCoverage, 0.9, '비율은 1 이하');
  assert.equal(c.reading.monologuePass, 0.8);
  assert.equal(c.reading.monologueTouchMin, 3);
  assert.deepEqual(c.cocreate.emotions, ['기쁨', '분노']);
  assert.deepEqual(c.cocreate.situations, DEFAULT_APP_CONFIG.cocreate.situations, '빈 글이 섞이면 목록째 기본값');
  assert.deepEqual(c.homeTips.ko, ['팁 하나']);
  assert.deepEqual(c.homeTips.en, DEFAULT_APP_CONFIG.homeTips.en, '빈 목록은 기본값');
  assert.equal(c.challenge.entryMinSeconds, 5);
  assert.equal(c.challenge.entryMaxSeconds, 90);
  assert.deepEqual(c.challenge.durationsDays, [7, 14], '0일은 안 된다');
});

test('parseAppConfig: 상한이 하한보다 작으면 상한을 되돌린다', () => {
  const c = parseAppConfig({ challenge: { entry_min_seconds: 10, entry_max_seconds: 5 } });
  assert.equal(c.challenge.entryMinSeconds, 10);
  assert.ok(c.challenge.entryMaxSeconds >= 10);
});

test('setAppConfig 는 구독자에게 알린다', () => {
  let calls = 0;
  const off = subscribeAppConfig(() => (calls += 1));
  setAppConfig(parseAppConfig({}));
  off();
  setAppConfig(parseAppConfig({}));
  assert.equal(calls, 1);
});

test('앱 평가: 바꾼 주기·횟수를 쓰는 순간 읽는다', () => {
  assert.equal(recordEvent(EMPTY_RATING_STATE, { kind: 'reading' }, 0).ask, false);
  setAppConfig(parseAppConfig({ rating: { reading_every: 1 } }));
  assert.equal(recordEvent(EMPTY_RATING_STATE, { kind: 'reading' }, 0).ask, true);
  setAppConfig(parseAppConfig({ rating: { reading_every: 1, max_asks: 1 } }));
  assert.equal(recordEvent({ ...EMPTY_RATING_STATE, asks: 1 }, { kind: 'reading' }, 0).ask, false);
});

test('독백 판정선: 통과선을 올리면 같은 말도 다르게 읽음이 된다', () => {
  const sentences = ['오늘은 정말 바다를 보러 가고 싶었어'];
  const said = '오늘은 정말 바다를 보러 가고 싶었다';
  assert.equal(alignSentences(sentences, said)[0].status, 'read');
  setAppConfig(parseAppConfig({ reading: { monologue_pass: 1 } }));
  assert.equal(alignSentences(sentences, said)[0].status, 'different');
});

test('홈 팁: 서버 목록에서 고르고, 기본은 locales 문장', () => {
  const now = new Date('2026-10-19T01:00:00Z');
  assert.equal(todayTip(now, 'ko'), ko.home.tips[tipIndex(now, ko.home.tips.length)]);
  assert.equal(todayTip(now, 'en'), en.home.tips[tipIndex(now, en.home.tips.length)]);
  setAppConfig(parseAppConfig({ home_tips: { ko: ['서버 팁'] } }));
  assert.equal(todayTip(now, 'ko'), '서버 팁');
});

test('대사 넘김: 말한 비율 기준을 쓰는 순간 읽는다', () => {
  const target = '가나다라마바사아자차';
  assert.equal(saidEnough(target, '가나다라마바사아자'), true);
  setAppConfig(parseAppConfig({ reading: { advance_coverage: 1 } }));
  assert.equal(saidEnough(target, '가나다라마바사아자'), false);
});

test('침묵 감지: currentVad 는 서버 값을 쓰고 DEFAULT_VAD 는 그대로', () => {
  assert.deepEqual(currentVad(), DEFAULT_VAD);
  setAppConfig(parseAppConfig({ reading: { silence_ms: 2500, vad_threshold: 0.03 } }));
  assert.deepEqual(currentVad(), { threshold: 0.03, silenceMs: 2500, minSpeechMs: 400, maxListenMs: 60000 });
  assert.equal(DEFAULT_VAD.silenceMs, 1800);
});

test('챌린지: 영상 길이·기간 선택지를 쓰는 순간 읽는다', () => {
  assert.equal(videoTooLong(61_000), true);
  assert.equal(videoTooShort(2_000), true);
  assert.equal(isDuration(30), false);
  setAppConfig(parseAppConfig({ challenge: { entry_min_seconds: 1, entry_max_seconds: 90, durations_days: [7, 30] } }));
  assert.equal(videoTooLong(61_000), false);
  assert.equal(videoTooShort(2_000), false);
  assert.equal(isDuration(30), true);
  assert.equal(isDuration(14), false);
});

test('쓰는 곳은 모듈 상수 대신 getAppConfig/currentVad 를 읽는다', () => {
  assert.match(read('hooks/use-reading-mic.ts'), /createSilenceDetector\(currentVad\(\), Date\.now\(\)\)/);
  assert.match(read('hooks/use-reading-stt.ts'), /createSilenceDetector\(currentVad\(\), Date\.now\(\)\)/);
  assert.match(read('app/reading/play.tsx'), /currentVad\(\)\.silenceMs/);
  const cocreate = read('app/script-cocreate.tsx');
  assert.match(cocreate, /getAppConfig\(\)\.cocreate\.emotions/);
  assert.match(cocreate, /getAppConfig\(\)\.cocreate\.situations/);
  assert.match(read('app/line-new.tsx'), /getAppConfig\(\)\.challenge\.durationsDays\.map/);
});

test('앱을 켤 때 설정을 받아 오되 기다리지 않는다', () => {
  assert.match(read('app/_layout.tsx'), /^void loadAppConfig\(\);$/m);
  const load = read('lib/app-config-load.ts');
  assert.match(load, /api\.getAppConfig\(\)/);
  assert.match(load, /AsyncStorage\.getItem/);
  assert.match(read('lib/api.ts'), /request\('\/v2\/app\/config', \{\}, \{ auth: false/);
});
