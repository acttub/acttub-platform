import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AnalysisTerminalError,
  OperationInactiveError,
  abandonAnalysis,
  createAnalysisOperationOwner,
  prepareSessionForPolling,
  readAnalyzedDetail,
  runAnalysisPipeline,
} from '../lib/analysis-operation.ts';

function uploadInput() {
  return {
    subtext: {
      situation: '카페',
      character: '배우',
      subtext: '감정을 숨긴다',
    },
    video: {
      uri: 'file:///original.mov',
      name: 'original.mov',
      mimeType: 'video/quicktime',
    },
    durationMs: 12_345,
  };
}

function completeDetail(sessionId = 'session-1') {
  return {
    session_id: sessionId,
    status: 'analyzed',
    situation: '카페',
    character_context: '배우',
    subtext: '감정을 숨긴다',
    created_at: '2026-07-23T00:00:00Z',
    updated_at: '2026-07-23T00:01:00Z',
    playback_url: 'https://cdn.test/video.mp4',
    summary: { summary_id: 'summary-1' },
  };
}

function createDependencies(overrides = {}) {
  return {
    compress: async () => ({
      kind: 'completed',
      uri: 'file:///compressed.mp4',
      originalBytes: 10_000,
      compressedBytes: 5_000,
    }),
    getFileSize: async () => 5_000,
    createUploadIntent: async () => ({
      intent_id: 'intent-1',
      upload_url: 'https://storage.test/upload',
    }),
    uploadToUrl: async () => ({ kind: 'uploaded' }),
    completeUpload: async () => {},
    createPracticeSession: async () => ({
      session_id: 'session-1',
      status: 'created',
    }),
    getStatus: async () => ({ status: 'analyzed', error_code: null }),
    reanalyze: async () => ({ session_id: 'session-1', status: 'analyzing' }),
    getDetail: async () => completeDetail(),
    savePending: async (record, scope) => ({
      key: `pending:${scope}`,
      record,
    }),
    removePending: async () => {},
    delay: async () => {},
    now: () => 0,
    pollIntervalMs: 4_000,
    pollTimeoutMs: 600_000,
    ...overrides,
  };
}

test('S1: 연속 run 두 번째는 무시되고 이전 generation의 side effect가 실행되지 않는다', async () => {
  const owner = createAnalysisOperationOwner({
    now: () => 100,
    instanceId: 'instance-a',
  });
  const first = owner.start();
  assert.ok(first);
  assert.equal(owner.start(), null);

  const effects = [];
  assert.equal(first.runIfActive(() => effects.push('first-active')), true);
  owner.finish(first);
  const second = owner.start();
  assert.ok(second);
  assert.notEqual(second.generation, first.generation);

  assert.equal(first.runIfActive(() => effects.push('late-callback')), false);
  assert.equal(first.runIfActive(() => effects.push('late-storage-write')), false);
  assert.equal(first.runIfActive(() => effects.push('late-storage-remove')), false);
  assert.equal(first.runIfActive(() => effects.push('late-navigation')), false);
  assert.equal(second.runIfActive(() => effects.push('second-active')), true);

  assert.deepEqual(effects, ['first-active', 'second-active']);
});

test('S2: 세션 생성 전 이탈은 압축을 취소하고 completeUpload를 호출하지 않는다', async () => {
  const owner = createAnalysisOperationOwner({
    now: () => 100,
    instanceId: 'instance-a',
  });
  const operation = owner.start();
  let compressionCancels = 0;
  let completeCalls = 0;
  let resolveCompression;
  const compression = new Promise((resolve) => {
    resolveCompression = resolve;
  });
  const dependencies = createDependencies({
    compress: async (_upload, currentOperation) => {
      currentOperation.attachCompressionCancel(() => {
        compressionCancels += 1;
        resolveCompression({ kind: 'cancelled' });
      });
      return compression;
    },
    completeUpload: async () => {
      completeCalls += 1;
    },
  });

  const pipeline = runAnalysisPipeline({
    operation,
    ownerId: 'user-1',
    upload: uploadInput(),
    recovered: null,
    retryFailed: false,
    dependencies,
  });
  for (let index = 0; index < 10 && compressionCancels === 0; index += 1) {
    await Promise.resolve();
    if (index === 1) {
      assert.equal(await owner.leave(operation), 'cancel-local');
    }
  }

  await assert.rejects(pipeline, (error) => error instanceof OperationInactiveError);
  assert.equal(compressionCancels, 1);
  assert.equal(completeCalls, 0);
});

test('E6: UploadTask 취소 결과는 completeUpload로 진행하지 않는다', async () => {
  const owner = createAnalysisOperationOwner({
    now: () => 100,
    instanceId: 'instance-upload-cancel',
  });
  const operation = owner.start();
  let uploadCancels = 0;
  let completeCalls = 0;
  let uploadStarted;
  const started = new Promise((resolve) => {
    uploadStarted = resolve;
  });
  const dependencies = createDependencies({
    uploadToUrl: async (_url, _uri, _mime, currentOperation) => {
      return new Promise((resolve) => {
        currentOperation.attachUploadCancel(() => {
          uploadCancels += 1;
          resolve({ kind: 'cancelled' });
        });
        uploadStarted();
      });
    },
    completeUpload: async () => {
      completeCalls += 1;
    },
  });

  const pipeline = runAnalysisPipeline({
    operation,
    ownerId: 'user-1',
    upload: uploadInput(),
    recovered: null,
    retryFailed: false,
    dependencies,
  });
  await started;
  assert.equal(await owner.leave(operation), 'cancel-local');
  await assert.rejects(pipeline, (error) => error instanceof OperationInactiveError);
  assert.equal(uploadCancels, 1);
  assert.equal(completeCalls, 0);
});

test('E6: 마지막 바이트 전송 직후 signal 취소도 downstream completeUpload를 막는다', async () => {
  const owner = createAnalysisOperationOwner({
    now: () => 100,
    instanceId: 'instance-upload-race',
  });
  const operation = owner.start();
  let completeCalls = 0;
  const dependencies = createDependencies({
    uploadToUrl: async () => {
      await owner.leave(operation);
      return { kind: 'uploaded' };
    },
    completeUpload: async () => {
      completeCalls += 1;
    },
  });

  await assert.rejects(
    runAnalysisPipeline({
      operation,
      ownerId: 'user-1',
      upload: uploadInput(),
      recovered: null,
      retryFailed: false,
      dependencies,
    }),
    (error) => error instanceof OperationInactiveError,
  );
  assert.equal(completeCalls, 0);
});

test('S2: 세션 생성 후 이탈은 폴링만 중단하고 pending record를 유지한다', async () => {
  const owner = createAnalysisOperationOwner({
    now: () => 100,
    instanceId: 'instance-a',
  });
  const operation = owner.start();
  let removeCalls = 0;
  let resolveStatusStarted;
  const statusStarted = new Promise((resolve) => {
    resolveStatusStarted = resolve;
  });
  const dependencies = createDependencies({
    getStatus: async (_sessionId, signal) => {
      resolveStatusStarted();
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
    removePending: async () => {
      removeCalls += 1;
    },
  });

  const pipeline = runAnalysisPipeline({
    operation,
    ownerId: 'user-1',
    upload: uploadInput(),
    recovered: null,
    retryFailed: false,
    dependencies,
  });
  await statusStarted;
  assert.equal(operation.sessionId, 'session-1');
  assert.ok(operation.pendingHandle);
  assert.equal(await owner.leave(operation), 'detach');
  await assert.rejects(pipeline);
  assert.equal(removeCalls, 0);
  assert.ok(operation.pendingHandle);
});

test('S2: abandon은 서버 삭제 후 자기 pending record만 제거한다', async () => {
  const calls = [];
  const handle = {
    key: 'pending:user-1:session-1:scope',
    record: {
      schemaVersion: 1,
      owner: 'user-1',
      session_id: 'session-1',
    },
  };

  assert.equal(
    await abandonAnalysis('session-1', handle, {
      deleteSession: async (sessionId) => {
        calls.push(`delete:${sessionId}`);
      },
      removePending: async (pending) => {
        calls.push(`remove:${pending.key}`);
      },
    }),
    'abandon',
  );
  assert.deepEqual(calls, [
    'delete:session-1',
    `remove:${handle.key}`,
  ]);
});

test('S2: abandon의 서버 삭제 404는 성공으로 보고 pending record를 제거한다', async () => {
  let removeCalls = 0;
  const handle = {
    key: 'pending:user-1:missing:scope',
    record: {
      schemaVersion: 1,
      owner: 'user-1',
      session_id: 'missing',
    },
  };

  await abandonAnalysis('missing', handle, {
    deleteSession: async () => {
      throw { status: 404 };
    },
    removePending: async () => {
      removeCalls += 1;
    },
  });
  assert.equal(removeCalls, 1);
});

for (const status of ['created', 'analyzing', 'analyzed', 'failed']) {
  test(`M2: status=${status}일 때 ${status === 'failed' ? 'reanalyze를 호출한다' : 'reanalyze를 호출하지 않는다'}`, async () => {
    const owner = createAnalysisOperationOwner({
      now: () => 100,
      instanceId: `instance-${status}`,
    });
    const operation = owner.start();
    let reanalyzeCalls = 0;
    const result = await prepareSessionForPolling(
      operation,
      'session-1',
      true,
      {
        getStatus: async () => ({ status, error_code: null }),
        reanalyze: async () => {
          reanalyzeCalls += 1;
          return { session_id: 'session-1', status: 'analyzing' };
        },
      },
    );

    assert.equal(result.status, status === 'failed' ? 'analyzing' : status);
    assert.equal(reanalyzeCalls, status === 'failed' ? 1 : 0);
  });
}

test('M2: analysis_retry_exhausted를 별도 terminal error로 분기한다', async () => {
  const owner = createAnalysisOperationOwner({
    now: () => 100,
    instanceId: 'instance-retry',
  });
  const operation = owner.start();

  await assert.rejects(
    prepareSessionForPolling(operation, 'session-1', true, {
      getStatus: async () => ({ status: 'failed', error_code: 'gemini_timeout' }),
      reanalyze: async () => {
        throw { status: 409, code: 'analysis_retry_exhausted' };
      },
    }),
    (error) =>
      error instanceof AnalysisTerminalError &&
      error.code === 'analysis_retry_exhausted',
  );
});

test('E8: analyzed detail의 summary/playback_url이 없으면 1회만 재조회 후 terminal error다', async () => {
  const owner = createAnalysisOperationOwner({
    now: () => 100,
    instanceId: 'instance-detail',
  });
  const operation = owner.start();
  let detailCalls = 0;
  let delayCalls = 0;

  await assert.rejects(
    readAnalyzedDetail(operation, 'session-1', {
      getDetail: async () => {
        detailCalls += 1;
        return { ...completeDetail(), summary: null, playback_url: undefined };
      },
      delay: async () => {
        delayCalls += 1;
      },
      retryDelayMs: 4_000,
    }),
    (error) =>
      error instanceof AnalysisTerminalError &&
      error.code === 'incomplete_analysis',
  );
  assert.equal(detailCalls, 2);
  assert.equal(delayCalls, 1);
});

test('M5: recovered session은 업로드 없이 detail로 hydrate하고 pending record를 제거한다', async () => {
  const owner = createAnalysisOperationOwner({
    now: () => 100,
    instanceId: 'instance-recovery',
  });
  const operation = owner.start();
  const recovered = {
    key: 'pending:user-1:session-1:old',
    record: {
      schemaVersion: 1,
      owner: 'user-1',
      session_id: 'session-1',
    },
  };
  let compressionCalls = 0;
  let removeCalls = 0;
  const detail = completeDetail();
  const result = await runAnalysisPipeline({
    operation,
    ownerId: 'user-1',
    upload: null,
    recovered,
    retryFailed: false,
    dependencies: createDependencies({
      compress: async () => {
        compressionCalls += 1;
        throw new Error('복구에서 압축을 호출하면 안 됩니다.');
      },
      getDetail: async () => detail,
      removePending: async (handle) => {
        removeCalls += 1;
        assert.equal(handle.key, recovered.key);
      },
    }),
  });

  assert.equal(compressionCalls, 0);
  assert.equal(removeCalls, 1);
  assert.equal(result.sessionId, 'session-1');
  assert.deepEqual(result.detail, detail);
});

test('E1: recovered session 404는 stale record를 제거하고 terminal error가 된다', async () => {
  const owner = createAnalysisOperationOwner({
    now: () => 100,
    instanceId: 'instance-stale',
  });
  const operation = owner.start();
  const recovered = {
    key: 'pending:user-1:deleted:old',
    record: {
      schemaVersion: 1,
      owner: 'user-1',
      session_id: 'deleted',
    },
  };
  let removeCalls = 0;

  await assert.rejects(
    runAnalysisPipeline({
      operation,
      ownerId: 'user-1',
      upload: null,
      recovered,
      retryFailed: false,
      dependencies: createDependencies({
        getStatus: async () => {
          throw { status: 404, code: 'not_found' };
        },
        removePending: async () => {
          removeCalls += 1;
        },
      }),
    }),
    (error) =>
      error instanceof AnalysisTerminalError &&
      error.code === 'stale_session',
  );
  assert.equal(removeCalls, 1);
});
