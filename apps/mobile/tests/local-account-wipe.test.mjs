import assert from 'node:assert/strict';
import test from 'node:test';

import { DEVICE_FILES_KEY, createDeviceFileLedger } from '../lib/device-files.ts';
import { clearAccountCacheData, wipeLocalAccountData } from '../lib/local-account-wipe.ts';
import { peekPendingUpload, setPendingUpload } from '../lib/practice.ts';
import { createFromParsed, getCurrent } from '../lib/reading/store.ts';
import { peekRecordedVideo, setRecordedVideo } from '../lib/recorded-video.ts';

const RECORDING_1 = 'file:///cache/Audio/recording-1.m4a';
const RECORDING_2 = 'file:///cache/Audio/recording-2.m4a';
const SPEECH = 'file:///cache/reading-1789000000000.wav';
const COMPRESSED_PHOTO = 'file:///cache/compressed-photo.jpg';
const ORIGINAL_VIDEO = 'file:///cache/ImagePicker/original.mov';

const READING_SCRIPTS = JSON.stringify([
  { id: 's_1', title: '옥상, 밤', lines: [], recordings: [{ id: 'r_1', uri: RECORDING_1 }] },
  { id: 's_2', title: '대본 둘', lines: [], recordings: [{ id: 'r_2', uri: RECORDING_2 }, { id: 'r_3' }] },
]);

/** 떠나는 사람의 폰. disk 가 지금 기기에 있는 파일, items 가 앱 저장소다. */
function phone({ undeletable = [] } = {}) {
  const items = new Map([
    ['acttub.reading.scripts', READING_SCRIPTS],
    ['acttub.consentPrefs', '{"terms":true}'],
    ['acttub.push.settings', '{"evening_reminder":true}'],
    ['acttub.push.lastPracticeDay', '2026-09-20'],
    ['acttub.pendingAnalysis', '{"session_id":"ps_1"}'],
    ['device.lastLoginProvider', 'kakao'],
    ['device.pendingPushTokenDeletions', '["T0"]'],
  ]);
  const disk = new Set([RECORDING_1, RECORDING_2, SPEECH, COMPRESSED_PHOTO, ORIGINAL_VIDEO]);
  const stuck = new Set(undeletable);
  const state = { nameDeleted: false };
  const storage = {
    getAllKeys: async () => [...items.keys()],
    getItem: async (key) => items.get(key) ?? null,
    setItem: async (key, value) => void items.set(key, value),
    removeItem: async (key) => void items.delete(key),
    multiRemove: async (keys) => {
      for (const key of keys) items.delete(key);
    },
  };
  const deleteFile = async (uri) => {
    if (stuck.has(uri)) throw new Error('file is busy');
    disk.delete(uri);
  };
  const deviceFiles = createDeviceFileLedger({
    storage,
    deleteFile,
    fileExists: async (uri) => disk.has(uri),
  });
  const dependencies = {
    storage,
    deleteFile,
    purgeDeviceFiles: () => deviceFiles.purge(),
    listSpeechFiles: async () => [...disk].filter((uri) => uri.endsWith('.wav')),
    deleteUserName: async () => {
      state.nameDeleted = true;
    },
  };
  return { items, disk, state, deviceFiles, dependencies };
}

test('account.withdraw: 탈퇴 뒤 폰의 앱 저장소에는 계정 자료 키가 하나도 없다', async () => {
  const { items, state, dependencies } = phone();

  await wipeLocalAccountData(dependencies);

  assert.deepEqual(
    [...items.keys()].filter((key) => key.startsWith('acttub.')),
    [],
  );
  assert.equal(state.nameDeleted, true);
});

test('account.withdraw: 탈퇴하면 이 기기에 저장된 리딩 녹음 파일을 지운다', async () => {
  const { disk, dependencies } = phone();

  await wipeLocalAccountData(dependencies);

  assert.equal(disk.has(RECORDING_1), false);
  assert.equal(disk.has(RECORDING_2), false);
});

test('account.withdraw: 탈퇴하면 대본을 읽어 준 음성 합성 파일을 지운다', async () => {
  const { disk, dependencies } = phone();

  await wipeLocalAccountData(dependencies);

  assert.equal(disk.has(SPEECH), false);
});

test('account.withdraw: 탈퇴하면 장부에 적힌 파일(줄인 사진·영상, 영상 원본 복사본)을 전부 지우고 장부도 남기지 않는다', async () => {
  const { items, disk, deviceFiles, dependencies } = phone();
  await deviceFiles.trackTemporary(COMPRESSED_PHOTO);
  await deviceFiles.keep(ORIGINAL_VIDEO);

  await wipeLocalAccountData(dependencies);

  assert.deepEqual([...disk], []);
  assert.equal(items.has(DEVICE_FILES_KEY), false);
});

test('account.withdraw: 탈퇴하면 메모리에 든 리딩 대본·올리던 연습·찍은 영상도 비운다', async () => {
  const { dependencies } = phone();
  await createFromParsed({ title: '옥상, 밤', roles: ['윤서'], lines: [] });
  setPendingUpload({
    scene: { situation: '', character: '', goal: '' },
    video: { uri: ORIGINAL_VIDEO, name: 'a.mov', mimeType: 'video/quicktime' },
    durationMs: 1000,
    blockage: null,
    theory: null,
  });
  setRecordedVideo({ uri: ORIGINAL_VIDEO, durationMs: 1000, name: 'a.mov' });
  assert.ok(getCurrent());

  await wipeLocalAccountData(dependencies);

  assert.equal(getCurrent(), null);
  assert.equal(peekPendingUpload(), null);
  assert.equal(peekRecordedVideo(), null);
});

test('account.withdraw: 파일 하나를 지우지 못해도 나머지 파일과 저장소 키는 지운다', async () => {
  const { items, disk, dependencies } = phone({ undeletable: [RECORDING_1] });

  await wipeLocalAccountData(dependencies);

  assert.deepEqual([...disk], [RECORDING_1, COMPRESSED_PHOTO, ORIGINAL_VIDEO]);
  assert.equal(items.has('acttub.reading.scripts'), false);
});

test('account.withdraw: 리딩 저장소 값이 깨져 있어도 던지지 않고 키를 지운다', async () => {
  const { items, dependencies } = phone();
  items.set('acttub.reading.scripts', '깨진 값');

  await wipeLocalAccountData(dependencies);

  assert.equal(items.has('acttub.reading.scripts'), false);
});

test('account.logout: 로그아웃은 계정 캐시(이름, 동의 상태)만 지우고 대본·중단된 분석·마지막 로그인 제공자 기억·기기 파일은 남긴다', async () => {
  const { items, disk, state, dependencies } = phone();

  await clearAccountCacheData(dependencies);

  assert.equal(state.nameDeleted, true);
  assert.equal(items.has('acttub.consentPrefs'), false);
  assert.equal(items.has('acttub.push.settings'), false);
  // 대본을 비롯한 배우의 자료는 서버에 있어 잃는 것이 없다. 기기 자료를 전부 지우는 것은 탈퇴다.
  assert.equal(items.has('acttub.reading.scripts'), true);
  assert.equal(items.has('acttub.pendingAnalysis'), true);
  assert.equal(items.get('device.lastLoginProvider'), 'kakao');
  assert.equal(items.has('device.pendingPushTokenDeletions'), true);
  assert.equal(disk.size, 5);
});

test('account.withdraw: 음성 합성 파일은 엔진이 만든 이름 그대로 다시 찾고, 다른 캐시 파일은 건드리지 않는다', async () => {
  const { isSpeechFileName, isSpeechFileOfScript, speechFileName, speechScriptFileName } =
    await import('../lib/reading/tts/speech-file.ts');

  // 옛 이름(시각으로 지은 것)도 계속 찾는다 — 기기에 남아 있다.
  assert.equal(isSpeechFileName(speechFileName(1789000000000)), true);
  // 지금 이름(대본 + 내용으로 지은 것)도 찾는다 (SOMA-547).
  assert.equal(isSpeechFileName(speechScriptFileName('script-1', 'abc123')), true);

  for (const other of ['reading-.wav', 'reading-12.wav.bak', 'recording-1.m4a', 'ExponentAsset-font.ttf']) {
    assert.equal(isSpeechFileName(other), false, other);
  }

  // 대본 하나만 지울 때 남의 대본 음성을 가져가지 않는다.
  assert.equal(isSpeechFileOfScript(speechScriptFileName('script-1', 'k'), 'script-1'), true);
  assert.equal(isSpeechFileOfScript(speechScriptFileName('script-2', 'k'), 'script-1'), false);
  assert.equal(isSpeechFileOfScript('recording-1.m4a', 'script-1'), false);
});
