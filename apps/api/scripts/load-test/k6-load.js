// dev API 부하 테스트. 올리는 법·돌리는 법·결과 읽는 법은 같은 폴더의 README.md.
// 보통은 run.sh가 홈서버에서 k6 컨테이너로 dev의 proxy 입구(BASE_URL=http://web:3000)에 보낸다.
// 기본은 초당 10 → 25 → 50 → 100건, 단계마다 1분. -e STAGES=10:10s 로 바꾼다.
// BASE_URL 을 비우면 https://dev.acttub.com(Cloudflare 경유)으로 보낸다.
// dev 전용 `development` 제공자로 테스트 계정 k6-load-<n>을 만들거나 다시 로그인한다.
// setup이 계정마다 약 40번 부르므로 1분 안에 다시 돌리면 계정당 분당 60회 한도(429)에 걸린다.
import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import exec from 'k6/execution';

const BASE = __ENV.BASE_URL || 'https://dev.acttub.com';
// 계정마다 분당 60회 한도가 있어 100 req/s를 계정 150개에 나눈다(계정당 분당 40회).
const ACCOUNTS = Number(__ENV.ACCOUNTS || 150);
const STAGES = (__ENV.STAGES || '10:1m,25:1m,50:1m,100:1m').split(',').map((s) => {
  const [target, duration] = s.split(':');
  return { target: Number(target), duration };
});
const HEADERS = { 'X-Acttub-Client': 'app/0.1.0', 'Content-Type': 'application/json' };
// 늘 같은 문장·목소리라 캐시에 있으면 Gemini를 부르지 않는다. 처음 한 번만 setup에서 합성된다.
const VOICE = { text: '부하 테스트 대사입니다.', voice: 'M1' };
// 서버는 Content-Type만 보고 audio/mp4면 변환 없이 저장한다(앱이 보내는 형식). 1,000바이트 미만은 422.
const AUDIO = new Uint8Array(4096).buffer;
// 계정 데이터는 운영 상위 5% 수준에 맞춘다(대본 약 1,000줄, 회원당 회차 14).
// 대본은 A·B가 번갈아 말하는 1,000줄이고 내 배역은 A다. 녹음은 A 대사 앞쪽 RECORDED_LINES줄에만 덮어쓴다.
const SCRIPT_LINES = 1000;
const SESSIONS = 14;
const RECORDED_LINES = 20;
// 운영 14일 요청 비율에 맞춘 구성. 대본 가져오기·코치·분석(AI 비용)과 관리자 경로는 뺀다.
const MIX = [
  ['progress', 26], ['recording', 7], ['voice', 5],
  ['/v2/me/notifications/unread-count', 8], ['/v2/reading/voice/status', 5], ['/v2/practices', 5],
  ['/v2/consents/entry', 4], ['script', 3], ['scriptSessions', 3], ['/v2/admissions', 3],
  ['/v2/reading/scripts', 2], ['/v2/me/notification-settings', 2], ['/v2/me', 2], ['/v2/challenges', 2],
  ['/v2/app/posters?platform=ios&locale=ko&app_version=0.1.0', 2], ['/v2/auditions', 1],
]
  // 무료 배우는 계정 첫 리딩 밖에서 목소리 합성이 503(cloud_voice_unavailable)이고 Sentry에 보고된다.
  // 테스트 계정은 무료라 기본으로 뺀다. Pro 계정으로 돌릴 때만 -e WITH_VOICE=1.
  .filter(([op]) => op !== 'voice' || __ENV.WITH_VOICE === '1')
  .flatMap(([op, weight]) => Array(weight).fill(op));
// 비교 실험: 부하 시작 뒤 NO_RECORDING_AFTER초부터 NO_RECORDING_UNTIL초까지 녹음을 빼고 같은 속도로 보낸다
// (요청마다 phase 태그).
const NO_RECORDING_AFTER = Number(__ENV.NO_RECORDING_AFTER || Infinity);
const NO_RECORDING_UNTIL = Number(__ENV.NO_RECORDING_UNTIL || Infinity);
const MIX_NO_RECORDING = MIX.filter((op) => op !== 'recording');

export const options = {
  setupTimeout: '30m',
  scenarios: {
    load: {
      executor: 'ramping-arrival-rate',
      startRate: STAGES[0].target,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 300,
      // 단계 사이를 5초에 올리고 나머지는 그 속도를 유지한다.
      stages: STAGES.flatMap(({ target, duration }) => [
        { target, duration: '5s' },
        { target, duration },
      ]),
    },
  },
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '10s' }],
    'http_req_duration{kind:api}': [{ threshold: 'p(95)<2000', abortOnFail: true, delayAbortEval: '10s' }],
    // 멈춤 조건이 아니라 요약에 phase별 시간을 찍으려는 것이다.
    ...(Number.isFinite(NO_RECORDING_AFTER) && {
      'http_req_duration{kind:api,phase:with_recording}': ['max>=0'],
      'http_req_duration{kind:api,phase:no_recording}': ['max>=0'],
    }),
  },
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
};

// 계정마다 고정 request_id라 다시 돌려도 대본·회차가 늘지 않는다.
const fixedId = (kind, n) => `00000000-0000-4000-8${kind}00-${String(n).padStart(12, '0')}`;

function call(method, path, token, body, expected = [200, 201]) {
  const headers = token ? { ...HEADERS, Authorization: `Bearer ${token}` } : HEADERS;
  const res = http.request(method, `${BASE}${path}`, body && JSON.stringify(body), { headers, tags: { kind: 'setup' } });
  if (!expected.includes(res.status)) fail(`${method} ${path} ${res.status} ${res.body.slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}

function signIn(n) {
  const id = `k6-load-${n}`;
  let res = call('POST', '/v2/auth/login', null, { provider: 'development', id_token: `${id}:${id}@example.com` });
  if (res.result === 'signup_required') {
    const decisions = res.documents.map((d) => ({ document_id: d.id, action: 'granted' }));
    res = call('POST', '/v2/auth/signup', null, { signup_token: res.signup_token, decisions, age_confirmed: true });
  }
  // 예전에 만든 계정은 문서의 새 버전이 나오면 재동의 전까지 다른 요청이 403(consent_required)이다.
  for (const d of call('GET', '/v2/consents/entry', res.access_token).undecided_documents) {
    call('POST', '/v2/consents', res.access_token, { document_id: d.id, action: 'granted' }, [200, 201, 204]);
  }
  return res.access_token;
}

function prepare(n, voiceDocumentId) {
  const token = signIn(n);
  call('PUT', '/v2/me/profile', token, {
    name: `k6 ${n}`, gender: 'unspecified', birth_date: '2000-01-01',
    directions: ['media'], experience: 'before_start', goal: 'hobby',
  });
  if (voiceDocumentId) call('POST', '/v2/consents', token, { document_id: voiceDocumentId, action: 'granted' }, [200, 201, 204]);
  const texts = Array.from({ length: SCRIPT_LINES }, (_, i) => `${i + 1}번째 대사입니다. 오늘도 같은 장면을 다시 연습합니다.`);
  const script = call('POST', '/v2/reading/scripts', token, {
    request_id: fixedId('c', n), title: 'k6', source: 'typed',
    raw_text: texts.map((t, i) => `${i % 2 ? 'B' : 'A'}: ${t}`).join('\n'),
    characters: [{ name: 'A' }, { name: 'B' }],
    lines: texts.map((text, i) => ({ ordinal: i + 1, kind: 'dialogue', character_index: i % 2, text })),
  });
  const lines = script.lines.map((l) => l.id);
  const mine = lines.filter((_, i) => i % 2 === 0).slice(0, RECORDED_LINES);
  const sessions = [];
  for (let k = 0; k < SESSIONS; k++) {
    sessions.push(call('POST', `/v2/reading/scripts/${script.id}/sessions`, token, {
      request_id: fixedId('d', n * 100 + k), my_character_ids: [script.characters[0].id], mode: 'read',
      start_line_id: lines[0], end_line_id: lines[lines.length - 1], advance: 'manual', record: true,
    }).id);
  }
  // 고정 request_id·attempt_no 1이라 다시 돌리면 올리지 않고 200(이미 더 큰 attempt_no로 덮였어도 같다).
  mine.forEach((line, k) => upload(token, sessions[0], line, fixedId('e', n * 100 + k), 1, [200, 201]));
  return { token, script: script.id, session: sessions[0], mine };
}

function upload(token, session, line, requestId, attemptNo, expected, tags = { kind: 'setup' }) {
  const res = http.post(`${BASE}/v2/reading/sessions/${session}/recordings`, {
    request_id: requestId, line_id: line, attempt_no: String(attemptNo),
    duration_ms: '1000', transcript_source: 'none',
    audio: http.file(AUDIO, 'line.m4a', 'audio/mp4'),
  }, { headers: { 'X-Acttub-Client': HEADERS['X-Acttub-Client'], Authorization: `Bearer ${token}` }, tags });
  if (expected && !expected.includes(res.status)) fail(`recording ${res.status} ${res.body.slice(0, 300)}`);
  return res;
}

export function setup() {
  const first = signIn(0);
  const docs = call('GET', '/v2/consents/documents', first).documents;
  const voiceDocument = docs.find((d) => d.type === 'cloud_voice');
  const accounts = [];
  for (let n = 0; n < ACCOUNTS; n++) {
    accounts.push(prepare(n, voiceDocument && voiceDocument.id));
    sleep(1.1); // 로그인·가입은 IP마다 분당 60회
  }
  // 캐시를 채운다. 캐시에 없을 때만 Gemini를 한 번 부른다.
  if (__ENV.WITH_VOICE === '1') call('POST', '/v2/reading/voice', accounts[0].token, VOICE);
  return { accounts };
}

export default function ({ accounts }) {
  const a = accounts[exec.scenario.iterationInTest % accounts.length];
  const elapsed = (Date.now() - exec.scenario.startTime) / 1000;
  const noRecording = elapsed > NO_RECORDING_AFTER && elapsed <= NO_RECORDING_UNTIL;
  const mix = noRecording ? MIX_NO_RECORDING : MIX;
  const op = mix[Math.floor(Math.random() * mix.length)];
  const phase = noRecording ? 'no_recording' : 'with_recording';
  const params = { headers: { ...HEADERS, Authorization: `Bearer ${a.token}` }, tags: { kind: 'api', op, phase } };
  const line = a.mine[Math.floor(Math.random() * a.mine.length)];
  let res;
  if (op === 'progress') {
    // 저장된 순번보다 커야 쓴다. 같은 계정 두 요청이 같은 ms면 뒤의 것은 쓰지 않고 200.
    res = http.patch(`${BASE}/v2/reading/sessions/${a.session}/progress`,
      JSON.stringify({ progress_seq: Date.now(), current_line_id: line, elapsed_seconds: 1 }), params);
  } else if (op === 'recording') {
    // 이미 녹음한 줄에 더 큰 attempt_no로 덮어써 S3 파일 수가 계정마다 RECORDED_LINES개로 유지된다.
    // int 범위라 2026년부터 0.1초 단위.
    res = upload(a.token, a.session, line, crypto.randomUUID(),
      Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 100), null, params.tags);
  } else if (op === 'voice') {
    res = http.post(`${BASE}/v2/reading/voice`, JSON.stringify(VOICE), params);
  } else if (op === 'script') {
    res = http.get(`${BASE}/v2/reading/scripts/${a.script}`, params);
  } else if (op === 'scriptSessions') {
    res = http.get(`${BASE}/v2/reading/scripts/${a.script}/sessions`, params);
  } else {
    res = http.get(`${BASE}${op}`, params);
  }
  if (!check(res, { '2xx': (r) => r.status >= 200 && r.status < 300, 'not 429': (r) => r.status !== 429 })) {
    console.warn(`${op} ${res.status} ${String(res.body).slice(0, 200)}`);
  }
}
