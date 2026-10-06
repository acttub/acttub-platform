import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError, NetworkError } from '../lib/api-request.ts';
import {
  importAlert,
  importBody,
  retryFlags,
  runImport,
  runScriptImport,
  scriptSplitDocument,
  uploadScriptFile,
} from '../lib/reading/script-import.ts';

const TEXT = { kind: 'text', text: '윤서: 여기 있을 줄 알았어.\n태오: 어떻게 알았어.', source: 'paste' };
const NETWORK = '네트워크 연결을 확인하고 다시 시도해주세요.';

const apiError = (status, code) => new ApiError(status, `raw ${code}`, code, code, { detail: code });

/** 나누기 서버 흉내. 시계는 sleep 만큼 간다. jobs 는 물을 때마다 하나씩 꺼내고 마지막 것은 계속 돌려준다. */
function fakeServer({ ticket = { import_id: 'imp-1', duplicate_script_id: null }, startError = null, jobs = [] } = {}) {
  const state = { now: 0, bodies: [], polls: 0, sleeps: [], progress: [] };
  const deps = {
    start: async (body) => {
      state.bodies.push(body);
      if (startError) throw startError;
      return ticket;
    },
    get: async (id) => {
      assert.equal(id, 'imp-1');
      const next = jobs[Math.min(state.polls, jobs.length - 1)];
      state.polls += 1;
      if (next instanceof Error) throw next;
      return { id, script_id: null, failure: null, ...next };
    },
    now: () => state.now,
    sleep: async (ms) => {
      state.sleeps.push(ms);
      state.now += ms;
    },
  };
  return { state, deps, onProgress: (p) => state.progress.push(`${p.done}/${p.total}`) };
}

const running = (done, total) => ({ status: 'running', progress: { done_lines: done, total_lines: total } });

test('reading.script(R2.11): 글을 보내고 1초마다 물어 진행 줄 수를 보이다가 저장된 대본 id로 끝난다', async () => {
  const { state, deps, onProgress } = fakeServer({
    jobs: [
      { status: 'pending', progress: { done_lines: 0, total_lines: 0 } },
      running(24, 61),
      { status: 'succeeded', progress: { done_lines: 61, total_lines: 61 }, script_id: 'sc-9' },
    ],
  });

  const result = await runImport(importBody(TEXT, {}, 'rid-1'), deps, onProgress);

  assert.deepEqual(result, { kind: 'saved', scriptId: 'sc-9' });
  assert.deepEqual(state.bodies, [
    { request_id: 'rid-1', allow_duplicate: false, skip_script_check: false, source: 'paste', raw_text: TEXT.text },
  ]);
  assert.deepEqual(state.progress, ['0/0', '24/61', '61/61']);
  assert.deepEqual(state.sleeps, [1000, 1000]);
});

test('reading.script(R2.11): 예시 대본처럼 접수 바로 끝난 작업은 기다리지 않는다', async () => {
  const { state, deps, onProgress } = fakeServer({
    jobs: [{ status: 'succeeded', progress: { done_lines: 17, total_lines: 17 }, script_id: 'sc-sample' }],
  });
  const sample = { kind: 'text', text: '옥상, 밤', source: 'sample' };

  assert.deepEqual(await runImport(importBody(sample, {}, 'rid-s'), deps, onProgress), { kind: 'saved', scriptId: 'sc-sample' });
  assert.equal(state.bodies[0].source, 'sample');
  assert.deepEqual(state.sleeps, []);
});

test('reading.script(R2.12): 120초가 지나도 끝나지 않으면 공용 오류로 멈춘다(물음 121번)', async () => {
  const { state, deps, onProgress } = fakeServer({ jobs: [running(3, 4000)] });

  const result = await runImport(importBody(TEXT, {}, 'rid-1'), deps, onProgress);

  assert.deepEqual(result, { kind: 'error', message: NETWORK });
  assert.equal(state.now, 120_000);
  assert.equal(state.polls, 121);
  assert.deepEqual(importAlert(result), { title: '저장', message: NETWORK });
});

test('reading.script: 묻다가 연결이 끊겨도 계속 묻고, 없는 작업(404)이면 멈춘다', async () => {
  const done = { status: 'succeeded', progress: { done_lines: 2, total_lines: 2 }, script_id: 'sc-1' };
  const flaky = fakeServer({ jobs: [new NetworkError(), apiError(503, 'unknown_error'), done] });
  assert.deepEqual(await runImport(importBody(TEXT, {}, 'r'), flaky.deps, flaky.onProgress), { kind: 'saved', scriptId: 'sc-1' });
  assert.equal(flaky.state.polls, 3);

  const gone = fakeServer({ jobs: [apiError(404, 'import_not_found')] });
  assert.deepEqual(await runImport(importBody(TEXT, {}, 'r'), gone.deps, gone.onProgress), { kind: 'error', message: 'raw import_not_found' });
  assert.equal(gone.state.polls, 1);
});

test('reading.script: 작업 실패 종류마다 팝업이 갈린다 — 대본 아님 R2.8, 배역 0명 R2.13, 너무 김·100개 R2.12, 그 밖 공용 오류', async () => {
  const outcome = async (failure) => {
    const { deps, onProgress } = fakeServer({ jobs: [{ status: 'failed', progress: { done_lines: 0, total_lines: 9 }, failure }] });
    const stop = await runImport(importBody(TEXT, {}, 'r'), deps, onProgress);
    return [stop.kind, importAlert(stop)];
  };
  assert.deepEqual(await outcome('not_script'), ['not_script', null]);
  assert.deepEqual(await outcome('no_characters'), [
    'no_characters',
    { title: '배역을 찾지 못했어요', message: '대본에 말하는 사람 이름이 있는지 확인하고 다시 넣어 주세요.' },
  ]);
  assert.deepEqual(await outcome('script_too_long'), [
    'too_long',
    { title: '저장', message: '대본이 너무 길어요. 원문 100,000자·줄 3,000개·배역 50명까지 저장할 수 있어요.' },
  ]);
  assert.deepEqual(await outcome('script_limit'), [
    'script_limit',
    { title: '저장', message: '대본은 100개까지 둘 수 있어요. 안 쓰는 대본을 지우면 다시 저장할 수 있어요.' },
  ]);
  assert.deepEqual(await outcome('failed'), ['error', { title: '저장', message: NETWORK }]);
});

test('reading.script(R2.7·R2.8): 같은 글이면 그 대본 id로 멈추고, 다시 보낼 때는 새 요청 id에 플래그를 단다', async () => {
  const dup = fakeServer({ ticket: { import_id: null, duplicate_script_id: 'sc-old' } });
  const stop = await runImport(importBody(TEXT, {}, 'rid-1'), dup.deps, dup.onProgress);
  assert.deepEqual(stop, { kind: 'duplicate', scriptId: 'sc-old' });
  assert.equal(dup.state.polls, 0);

  assert.deepEqual(importBody(TEXT, retryFlags(stop), 'rid-2'), {
    request_id: 'rid-2', allow_duplicate: true, skip_script_check: false, source: 'paste', raw_text: TEXT.text,
  });
  const file = { kind: 'file', file: { uri: 'file:///a.pdf', name: 'a.pdf', size: 10 }, uploadId: 'up-1' };
  assert.deepEqual(importBody(file, retryFlags({ kind: 'not_script' }), 'rid-3'), {
    request_id: 'rid-3', allow_duplicate: false, skip_script_check: true, source: 'file', upload_id: 'up-1',
  });
  assert.equal(retryFlags({ kind: 'daily_limit' }), null);
});

test('reading.script(R2.14·R2.15): 접수 거절 — 동의 없음은 시트, 하루 한도는 알림, 연결 끊김은 공용 오류', async () => {
  const stopFor = async (error) => {
    const { deps, onProgress } = fakeServer({ startError: error });
    return runImport(importBody(TEXT, {}, 'r'), deps, onProgress);
  };
  const consent = await stopFor(apiError(403, 'script_split_consent_required'));
  assert.deepEqual(consent, { kind: 'consent' });
  assert.equal(importAlert(consent), null);

  assert.deepEqual(importAlert(await stopFor(apiError(429, 'script_split_daily_limit'))), {
    title: '오늘은 대본을 더 넣을 수 없어요',
    message: '대본은 하루 20번까지 나눌 수 있어요.\n내일 다시 넣어 주세요.',
  });
  assert.deepEqual(await stopFor(apiError(422, 'script_limit')), { kind: 'script_limit' });
  assert.deepEqual(await stopFor(new NetworkError()), { kind: 'error', message: NETWORK });
});

test('reading.script(R2.14): 동의한 뒤 같은 본문을 다시 보내면 나눈다 — 동의 문서는 script_split 현재 판', async () => {
  let granted = false;
  const { state, deps, onProgress } = fakeServer({
    jobs: [{ status: 'succeeded', progress: { done_lines: 4, total_lines: 4 }, script_id: 'sc-2' }],
  });
  const start = deps.start;
  deps.start = async (body) => {
    if (!granted) {
      state.bodies.push(body);
      throw apiError(403, 'script_split_consent_required');
    }
    return start(body);
  };
  const body = importBody(TEXT, {}, 'rid-1');

  assert.deepEqual(await runImport(body, deps, onProgress), { kind: 'consent' });
  const documents = [
    { id: 'd-terms', type: 'terms' },
    { id: 'd-split', type: 'script_split' },
  ];
  assert.equal(scriptSplitDocument(documents)?.id, 'd-split');
  assert.equal(scriptSplitDocument([{ id: 'd-terms', type: 'terms' }]), null, '법무 문서가 없으면 없다');
  granted = true;
  assert.deepEqual(await runImport(body, deps, onProgress), { kind: 'saved', scriptId: 'sc-2' });
  assert.deepEqual(state.bodies[0], state.bodies[1]);
});

test('reading.script(R2.2): 파일은 올릴 자리 → PUT → 읽기 세 단계로 올리고 upload_id 를 받는다', async () => {
  const calls = [];
  const deps = {
    create: async (body) => {
      calls.push(['create', body]);
      return { upload_id: 'up-1', upload_url: 'https://s3/put', content_type: 'application/octet-stream', expires_at: 'x' };
    },
    put: async (url, uri, contentType) => void calls.push(['put', url, uri, contentType]),
    complete: async (id) => void calls.push(['complete', id]),
  };

  const result = await uploadScriptFile({ uri: 'file:///갈매기.pdf', name: '갈매기 3막.pdf', size: 50_000_000 }, deps);

  assert.deepEqual(result, { kind: 'uploaded', uploadId: 'up-1' });
  assert.deepEqual(calls, [
    ['create', { file_name: '갈매기 3막.pdf', byte_size: 50_000_000 }],
    ['put', 'https://s3/put', 'file:///갈매기.pdf', 'application/octet-stream'],
    ['complete', 'up-1'],
  ]);
});

test('reading.script(R2.4): 50MB 넘는 파일은 올리지 않고, 서버가 못 읽은 파일·긴 글·동의 없음은 각자의 팝업이다', async () => {
  const failing = (step, error) => {
    const calls = [];
    const deps = {
      create: async () => {
        calls.push('create');
        if (step === 'create') throw error;
        return { upload_id: 'up-1', upload_url: 'u', content_type: 'application/octet-stream', expires_at: 'x' };
      },
      put: async () => void calls.push('put'),
      complete: async () => {
        calls.push('complete');
        if (step === 'complete') throw error;
      },
    };
    return { calls, deps };
  };
  const file = { uri: 'file:///a.pdf', name: 'a.pdf', size: 1_000 };

  const big = failing(null);
  const tooLarge = await uploadScriptFile({ ...file, size: 50_000_001 }, big.deps);
  assert.deepEqual(importAlert(tooLarge), { title: '파일을 읽지 못했어요', message: '파일이 너무 커요. 50MB까지 열 수 있어요.' });
  assert.deepEqual(big.calls, []);

  const scan = failing('complete', apiError(422, 'script_file_unreadable'));
  assert.deepEqual(importAlert(await uploadScriptFile(file, scan.deps)), {
    title: '파일을 읽지 못했어요',
    message: '대본을 읽지 못했어요. 스캔한 PDF이거나 지원하지 않는 형식일 수 있어요. 복사해서 붙여넣어 주세요.',
  });
  assert.deepEqual(scan.calls, ['create', 'put', 'complete']);

  assert.deepEqual(await uploadScriptFile(file, failing('complete', apiError(422, 'script_too_long')).deps), { kind: 'too_long' });
  assert.deepEqual(await uploadScriptFile(file, failing('complete', apiError(429, 'script_upload_busy')).deps), { kind: 'unread', uploadId: 'up-1' });
  assert.deepEqual(importAlert({ kind: 'busy' }), { title: '저장', message: '요청이 잠시 몰렸어요. 1분 뒤에 다시 시도해주세요.' });
  const noConsent = failing('create', apiError(403, 'script_split_consent_required'));
  assert.deepEqual(await uploadScriptFile(file, noConsent.deps), { kind: 'consent' });
  assert.deepEqual(noConsent.calls, ['create']);
});

/** 파일 나누기 서버 흉내: 원본 읽기·올리기·접수를 한 장부에 적는다. used 에 든 upload_id 는 이미 대본이 된 원본이다. */
function fileServer({ used = [], completeErrors = [] } = {}) {
  const calls = [];
  let uploads = 1;
  const done = { status: 'succeeded', progress: { done_lines: 5, total_lines: 5 }, script_id: 'sc-f', failure: null };
  const deps = {
    newRequestId: (() => {
      let n = 0;
      return () => `rid-${++n}`;
    })(),
    upload: {
      create: async (body) => {
        calls.push(['create', body.file_name]);
        return { upload_id: `up-${++uploads}`, upload_url: 'u', content_type: 'application/octet-stream', expires_at: 'x' };
      },
      put: async () => void calls.push(['put']),
      complete: async (id) => {
        calls.push(['complete', id]);
        const error = completeErrors.shift();
        if (error) throw error;
      },
    },
    import: {
      start: async (body) => {
        calls.push(['import', body.upload_id, body.request_id]);
        if (used.includes(body.upload_id)) throw apiError(422, 'script_upload_used');
        return { import_id: 'imp-1', duplicate_script_id: null };
      },
      get: async (id) => ({ id, ...done }),
      now: () => 0,
      sleep: async () => {},
    },
  };
  return { calls, deps };
}

const PICKED = { uri: 'file:///갈매기.pdf', name: '갈매기 3막.pdf', size: 1000 };

test('reading.script(R2): 파일 [다음]은 원본 읽기를 다시 불러(읽은 원본이면 바로 204) 읽기 자리가 없던 파일도 나눈다', async () => {
  const { calls, deps } = fileServer();
  const uploaded = [];
  const result = await runScriptImport({ kind: 'file', file: PICKED, uploadId: 'up-1' }, {}, deps, () => {}, (id) => uploaded.push(id));

  assert.deepEqual(result, { kind: 'saved', scriptId: 'sc-f' });
  assert.deepEqual(calls, [['complete', 'up-1'], ['import', 'up-1', 'rid-1']]);
  assert.deepEqual(uploaded, []);

  const busy = fileServer({ completeErrors: [apiError(429, 'script_upload_busy')] });
  assert.deepEqual(await runScriptImport({ kind: 'file', file: PICKED, uploadId: 'up-1' }, {}, busy.deps, () => {}, () => {}), { kind: 'busy' });
  assert.deepEqual(busy.calls, [['complete', 'up-1']], '읽기 자리가 없으면 접수하지 않는다');
});

test('reading.script(R2): 이미 대본이 된 원본(script_upload_used)이면 고른 파일을 다시 올려 새 upload_id·새 요청 id로 한 번 더 보낸다', async () => {
  const { calls, deps } = fileServer({ used: ['up-1'] });
  const uploaded = [];

  const result = await runScriptImport({ kind: 'file', file: PICKED, uploadId: 'up-1' }, { allowDuplicate: true }, deps, () => {}, (id) => uploaded.push(id));

  assert.deepEqual(result, { kind: 'saved', scriptId: 'sc-f' });
  assert.deepEqual(calls, [
    ['complete', 'up-1'],
    ['import', 'up-1', 'rid-1'],
    ['create', '갈매기 3막.pdf'],
    ['put'],
    ['complete', 'up-2'],
    ['import', 'up-2', 'rid-2'],
  ]);
  assert.deepEqual(uploaded, ['up-2']);
});
