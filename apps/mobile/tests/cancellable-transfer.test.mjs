import assert from 'node:assert/strict';
import test from 'node:test';

import { startCancellableCompression } from '../lib/cancellable-transfer.ts';

test('M7: compressor cancellation id가 늦게 도착해도 해당 uuid를 취소한다', async () => {
  let provideCancellationId;
  let resolveCompression;
  const cancelledIds = [];
  const task = startCancellableCompression({
    originalUri: 'file:///original.mov',
    run: async (onCancellationId) => {
      provideCancellationId = onCancellationId;
      return new Promise((resolve) => {
        resolveCompression = resolve;
      });
    },
    cancelNative: (id) => {
      cancelledIds.push(id);
    },
    removeOutput: async () => {},
  });

  await task.cancel();
  provideCancellationId('compress-uuid-1');
  resolveCompression({ uri: 'file:///compressed.mp4' });

  assert.deepEqual(await task.result, { kind: 'cancelled' });
  assert.deepEqual(cancelledIds, ['compress-uuid-1']);
});

test('E5: 압축 취소 산출물만 정리하고 원본 URI는 절대 삭제하지 않는다', async () => {
  const removed = [];
  let resolveCompression;
  const task = startCancellableCompression({
    originalUri: 'file:///original.mov',
    run: async (onCancellationId) => {
      onCancellationId('compress-uuid-2');
      return new Promise((resolve) => {
        resolveCompression = resolve;
      });
    },
    cancelNative: () => {},
    removeOutput: async (uri) => {
      removed.push(uri);
    },
  });

  await task.cancel();
  resolveCompression({ uri: 'file:///partial-compressed.mp4' });
  assert.deepEqual(await task.result, { kind: 'cancelled' });
  assert.deepEqual(removed, ['file:///partial-compressed.mp4']);

  const originalResult = startCancellableCompression({
    originalUri: 'file:///original.mov',
    run: async () => ({ uri: 'file:///original.mov' }),
    cancelNative: () => {},
    removeOutput: async (uri) => {
      removed.push(uri);
    },
  });
  await originalResult.cancel();
  assert.deepEqual(await originalResult.result, { kind: 'cancelled' });
  assert.deepEqual(removed, ['file:///partial-compressed.mp4']);
});
