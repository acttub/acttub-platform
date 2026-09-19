import assert from 'node:assert/strict';
import test from 'node:test';
import './ts-module-loader.mjs';
const { videoRecordRows } = await import('../src/features/practice/video-record-rows.ts');

const summary = {
  schema_version: 'acttub.video_record_summary.v1', record_id: 'r1', record_version: 1, duration_ms: 8000,
  status: 'partial', processed_ranges: [{ start_ms: 0, end_ms: 6000 }], missing_ranges: [{ start_ms: 6000, end_ms: 8000 }],
  observed_scene: ['한 사람이 정면을 보며 서 있다.'], spoken_content: ['가지 마'],
  limitations: [{ start_ms: 0, end_ms: 8000, description: '손은 화면 밖이다.' }],
};

test('video record summary becomes scene rows and spells out the missing range', () => {
  const rows = videoRecordRows(summary, 'https://dev.acttub.com');
  assert.deepEqual(rows.map(([label]) => label), ['영상에서 본 것', '들린 대사', '확인하지 못한 것', '기록 상태']);
  assert.equal(rows[1][1], '가지 마');
  assert.ok(rows[2][1].includes('00:00~00:08 손은 화면 밖이다.'));
  assert.ok(rows[3][1].includes('00:06~00:08'));
});

test('a ready record without limitations does not invent a status row', () => {
  const rows = videoRecordRows({ ...summary, status: 'ready', missing_ranges: [], limitations: [] }, 'https://dev.acttub.com');
  assert.deepEqual(rows.map(([label]) => label), ['영상에서 본 것', '들린 대사']);
});

test('production and unknown environments never display record rows', () => {
  for (const site of ['https://acttub.com', 'https://www.acttub.com', '', 'invalid', 'https://dev.acttub.com.example.com']) {
    assert.deepEqual(videoRecordRows(summary, site), []);
  }
});

test('legacy observation packs and missing summaries render no record rows', () => {
  assert.deepEqual(videoRecordRows({ summary_id: 's', observations: [], uncertainties: [] }, 'https://dev.acttub.com'), []);
  assert.deepEqual(videoRecordRows(null, 'https://dev.acttub.com'), []);
  assert.deepEqual(videoRecordRows(undefined, 'https://dev.acttub.com'), []);
});
