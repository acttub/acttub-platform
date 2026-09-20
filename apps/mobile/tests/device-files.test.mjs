import assert from 'node:assert/strict';
import test from 'node:test';

import { DEVICE_FILES_KEY, createDeviceFileLedger } from '../lib/device-files.ts';

/** 기기의 파일 시스템 흉내. files 가 지금 기기에 있는 파일이다. */
function harness({ files = [], undeletable = [] } = {}) {
  const items = new Map();
  const disk = new Set(files);
  const stuck = new Set(undeletable);
  const ledger = createDeviceFileLedger({
    storage: {
      getItem: async (key) => items.get(key) ?? null,
      setItem: async (key, value) => void items.set(key, value),
      removeItem: async (key) => void items.delete(key),
    },
    deleteFile: async (uri) => {
      if (stuck.has(uri)) throw new Error('file is busy');
      disk.delete(uri);
    },
    fileExists: async (uri) => disk.has(uri),
  });
  return { ledger, items, disk, stuck };
}

const COMPRESSED = 'file:///cache/compressed-1.mp4';
const ORIGINAL = 'file:///cache/ImagePicker/original-1.mov';

test('account.withdraw: 올리려고 만든 임시 파일은 장부에 올리고, 다 쓰면 파일을 지우고 장부에서 뺀다', async () => {
  const { ledger, items, disk } = harness({ files: [COMPRESSED] });

  await ledger.trackTemporary(COMPRESSED);
  assert.deepEqual(await ledger.entries(), { temporary: [COMPRESSED], kept: [] });
  await ledger.discard([COMPRESSED]);

  assert.equal(disk.has(COMPRESSED), false);
  // 남은 것이 없으면 장부 키도 두지 않는다.
  assert.equal(items.has(DEVICE_FILES_KEY), false);
});

test('account.withdraw: 앱이 죽어 장부에 남은 임시 파일은 다음 실행 때 지운다', async () => {
  const { ledger, items, disk } = harness({ files: [COMPRESSED] });
  await ledger.trackTemporary(COMPRESSED);
  // 여기서 앱이 죽었다 — discard 가 불리지 않았다.

  await ledger.sweep();

  assert.equal(disk.has(COMPRESSED), false);
  assert.equal(items.has(DEVICE_FILES_KEY), false);
});

test('account.withdraw: 다음 실행의 정리는 코치 화면이 다시 트는 영상 원본 복사본을 지우지 않고, OS가 이미 치운 것만 장부에서 뺀다', async () => {
  const gone = 'file:///cache/ImagePicker/purged-by-os.mov';
  const { ledger, disk } = harness({ files: [ORIGINAL] });
  await ledger.keep(ORIGINAL);
  await ledger.keep(gone);

  await ledger.sweep();

  assert.equal(disk.has(ORIGINAL), true);
  assert.deepEqual(await ledger.entries(), { temporary: [], kept: [ORIGINAL] });
});

test('account.withdraw: 탈퇴하면 임시 파일과 영상 원본 복사본을 전부 지우고 장부 키도 남기지 않는다', async () => {
  const { ledger, items, disk } = harness({ files: [COMPRESSED, ORIGINAL] });
  await ledger.trackTemporary(COMPRESSED);
  await ledger.keep(ORIGINAL);

  await ledger.purge();

  assert.deepEqual([...disk], []);
  assert.equal(items.has(DEVICE_FILES_KEY), false);
});

test('account.withdraw: 탈퇴 때 지우지 못한 파일은 장부에 남겨 다음 실행 때 다시 지운다', async () => {
  const { ledger, disk, stuck } = harness({ files: [COMPRESSED, ORIGINAL], undeletable: [ORIGINAL] });
  await ledger.trackTemporary(COMPRESSED);
  await ledger.keep(ORIGINAL);

  await ledger.purge();
  assert.deepEqual([...disk], [ORIGINAL]);
  // 계정이 사라졌으므로 더는 보관할 파일이 아니다 — 다음 실행이 지울 임시 파일로 남긴다.
  assert.deepEqual(await ledger.entries(), { temporary: [ORIGINAL], kept: [] });

  stuck.clear();
  await ledger.sweep();
  assert.deepEqual([...disk], []);
});

test('account.withdraw: 다 쓴 임시 파일을 지우지 못하면 장부에 남아 다음 실행 때 다시 지운다', async () => {
  const { ledger, disk, stuck } = harness({ files: [COMPRESSED], undeletable: [COMPRESSED] });
  await ledger.trackTemporary(COMPRESSED);

  await ledger.discard([COMPRESSED]);
  assert.deepEqual(await ledger.entries(), { temporary: [COMPRESSED], kept: [] });

  stuck.clear();
  await ledger.sweep();
  assert.equal(disk.has(COMPRESSED), false);
});

test('account.withdraw: 장부에 올리기가 겹쳐도 서로 덮어쓰지 않고, 같은 파일은 한 번만 적는다', async () => {
  const { ledger } = harness({ files: [COMPRESSED, ORIGINAL] });

  await Promise.all([
    ledger.trackTemporary(COMPRESSED),
    ledger.keep(ORIGINAL),
    ledger.keep(ORIGINAL),
  ]);

  assert.deepEqual(await ledger.entries(), { temporary: [COMPRESSED], kept: [ORIGINAL] });
});

test('account.withdraw: 장부에 없는 파일도 다 썼으면 지우고, 빈 값은 건너뛴다', async () => {
  const { ledger, disk } = harness({ files: [COMPRESSED] });

  await ledger.discard([COMPRESSED, null, undefined, '']);

  assert.equal(disk.has(COMPRESSED), false);
});

test('account.withdraw: 저장소가 깨져 있어도 장부는 던지지 않는다 — 파일 정리가 올리기를 막지 않는다', async () => {
  const broken = {
    getItem: async () => {
      throw new Error('storage broken');
    },
    setItem: async () => {
      throw new Error('storage broken');
    },
    removeItem: async () => {
      throw new Error('storage broken');
    },
  };
  const deleted = [];
  const ledger = createDeviceFileLedger({
    storage: broken,
    deleteFile: async (uri) => void deleted.push(uri),
    fileExists: async () => true,
  });

  await ledger.trackTemporary(COMPRESSED);
  await ledger.keep(ORIGINAL);
  await ledger.discard([COMPRESSED]);
  await ledger.sweep();
  await ledger.purge();

  assert.deepEqual(deleted, [COMPRESSED]);
});

test('account.withdraw: 장부 값이 깨져 있으면 빈 장부로 읽는다', async () => {
  const { ledger, items } = harness();
  items.set(DEVICE_FILES_KEY, '깨진 값');

  assert.deepEqual(await ledger.entries(), { temporary: [], kept: [] });
});

test('account.withdraw: 올리기 한 번이 만든 임시 파일은 올리기가 성공하든 실패하든 끝나면 지운다', async () => {
  const { withTemporaryFiles } = await import('../lib/device-files.ts');
  for (const outcome of ['성공', '실패', '취소']) {
    const { ledger, disk } = harness({ files: [COMPRESSED, ORIGINAL] });

    const running = withTemporaryFiles(ledger, async (trackTemporary) => {
      await trackTemporary(COMPRESSED);
      // 올리는 동안에는 장부에 있고 파일도 그대로다.
      assert.deepEqual(await ledger.entries(), { temporary: [COMPRESSED], kept: [] });
      assert.equal(disk.has(COMPRESSED), true);
      if (outcome !== '성공') throw new Error(outcome);
      return 'session-1';
    });

    if (outcome === '성공') assert.equal(await running, 'session-1');
    else await assert.rejects(running, new RegExp(outcome));
    assert.equal(disk.has(COMPRESSED), false, outcome);
    // 원본 복사본은 코치 화면이 다시 틀기 때문에 건드리지 않는다.
    assert.equal(disk.has(ORIGINAL), true, outcome);
  }
});

test('account.withdraw: 앱이 만든 파일(file://)만 장부에 올리고 지운다 — content:// 나 blob: 은 이 앱의 파일이 아니다', async () => {
  const foreign = ['content://media/external/video/1', 'blob:https://acttub.com/1234', 'ph://asset-1'];
  const { ledger, items, disk } = harness({ files: foreign });

  for (const uri of foreign) {
    await ledger.trackTemporary(uri);
    await ledger.keep(uri);
  }
  await ledger.discard(foreign);

  assert.equal(items.has(DEVICE_FILES_KEY), false);
  assert.deepEqual([...disk], foreign);
});
