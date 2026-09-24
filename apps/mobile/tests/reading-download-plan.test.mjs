import assert from 'node:assert/strict';
import test from 'node:test';

import { checkDownloaded, hasEnoughSpace, missingBytes, planModelDownload } from '../lib/reading/tts/download-plan.ts';

const MB = 1024 * 1024;

test('받기 계획: 임시 파일이 다 받아져 있으면 받지 않고 제자리로 옮긴다', () => {
  assert.deepEqual(planModelDownload({ platform: 'ios', expectedBytes: 10, partBytes: 10, savedResumeData: null }), { action: 'finalize' });
});

test('받기 계획: 안드로이드는 남은 임시 파일 크기부터 이어받는다', () => {
  assert.deepEqual(
    planModelDownload({ platform: 'android', expectedBytes: 100, partBytes: 40, savedResumeData: null }),
    { action: 'download', resumeData: '40', discardPart: false },
  );
  // 안드로이드는 저장한 값보다 실제 파일 크기를 믿는다.
  assert.deepEqual(
    planModelDownload({ platform: 'android', expectedBytes: 100, partBytes: 60, savedResumeData: '40' }),
    { action: 'download', resumeData: '60', discardPart: false },
  );
});

test('받기 계획: iOS는 저장해 둔 이어받기 정보가 있을 때만 이어받는다', () => {
  assert.deepEqual(
    planModelDownload({ platform: 'ios', expectedBytes: 100, partBytes: null, savedResumeData: 'b64' }),
    { action: 'download', resumeData: 'b64', discardPart: false },
  );
  assert.deepEqual(
    planModelDownload({ platform: 'ios', expectedBytes: 100, partBytes: null, savedResumeData: null }),
    { action: 'download', resumeData: null, discardPart: false },
  );
});

test('받기 계획: 크기가 넘치거나 이어받을 수 없는 조각은 버리고 처음부터 받는다', () => {
  assert.deepEqual(
    planModelDownload({ platform: 'android', expectedBytes: 100, partBytes: 150, savedResumeData: null }),
    { action: 'download', resumeData: null, discardPart: true },
  );
  assert.deepEqual(
    planModelDownload({ platform: 'ios', expectedBytes: 100, partBytes: 30, savedResumeData: null }),
    { action: 'download', resumeData: null, discardPart: true },
  );
  assert.deepEqual(
    planModelDownload({ platform: 'android', expectedBytes: 100, partBytes: 0, savedResumeData: null }),
    { action: 'download', resumeData: null, discardPart: true },
  );
});

test('받은 뒤 검사: 크기가 맞으면 ok, 모자라면 이어받을 수 있고, 넘치거나 오류 응답이면 버린다', () => {
  assert.equal(checkDownloaded({ expectedBytes: 100, actualBytes: 100, status: 200 }), 'ok');
  assert.equal(checkDownloaded({ expectedBytes: 100, actualBytes: 100, status: 206 }), 'ok');
  assert.equal(checkDownloaded({ expectedBytes: 100, actualBytes: 70, status: 206 }), 'short');
  assert.equal(checkDownloaded({ expectedBytes: 100, actualBytes: 200, status: 200 }), 'corrupt');
  assert.equal(checkDownloaded({ expectedBytes: 100, actualBytes: 100, status: 404 }), 'corrupt');
  assert.equal(checkDownloaded({ expectedBytes: 100, actualBytes: 0, status: 500 }), 'corrupt');
});

test('남은 용량: 받을 크기와 여유분보다 빈 공간이 적으면 부족하다', () => {
  assert.equal(hasEnoughSpace({ freeBytes: 500 * MB, neededBytes: 380 * MB }), true);
  assert.equal(hasEnoughSpace({ freeBytes: 400 * MB, neededBytes: 380 * MB }), false); // 여유분 50MB
  assert.equal(hasEnoughSpace({ freeBytes: null, neededBytes: 380 * MB }), true); // 모르면 막지 않는다
  assert.equal(hasEnoughSpace({ freeBytes: 10 * MB, neededBytes: 0 }), true); // 받을 게 없으면 통과
});

test('남은 용량: 받아야 할 양은 이미 받은 파일과 조각을 뺀 것이다', () => {
  assert.equal(
    missingBytes([
      { expectedBytes: 100, presentBytes: 100 },
      { expectedBytes: 200, presentBytes: 50 },
      { expectedBytes: 300, presentBytes: 0 },
      { expectedBytes: 10, presentBytes: 999 },
    ]),
    450,
  );
});
