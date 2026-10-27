import test from 'node:test';
import assert from 'node:assert/strict';
import { compareRows, lengthChange, previousRecordedSession } from '../lib/reading/compare.ts';
const rec=(line_id,attempt_no,duration_ms,url='https://a')=>({id:`${line_id}-${attempt_no}-${duration_ms}`,line_id,attempt_no,duration_ms,content_type:'audio/m4a',byte_size:1,transcript:null,transcript_source:'none',playback_url:url,playback_expires_at:null});
test('이번 회차보다 먼저 녹음한 가장 최근 회차를 고른다',()=>{
 const sessions=[
  {id:'a',started_at:'2026-10-20T10:00:00Z',recorded_line_count:3},
  {id:'b',started_at:'2026-10-25T10:00:00Z',recorded_line_count:2},
  {id:'c',started_at:'2026-10-26T10:00:00Z',recorded_line_count:0},
  {id:'now',started_at:'2026-10-27T10:00:00Z',recorded_line_count:4},
  {id:'later',started_at:'2026-10-28T10:00:00Z',recorded_line_count:4},
 ];
 assert.equal(previousRecordedSession(sessions,{id:'now',started_at:'2026-10-27T10:00:00Z'}),'b');
 assert.equal(previousRecordedSession(sessions,{id:'now'}),'later');
 assert.equal(previousRecordedSession([sessions[3]],{id:'now',started_at:'2026-10-27T10:00:00Z'}),null);
});
test('두 회차 모두 들을 수 있는 줄만 대본 순서로, 마지막 시도를 쓴다',()=>{
 const rows=compareRows(['l1','l2','l3','l4'],
  [rec('l3',1,2000),rec('l1',1,1000),rec('l1',2,1500),rec('l2',1,900,null)],
  [rec('l1',1,1200),rec('l2',1,800),rec('l3',1,0),rec('l4',1,700)]);
 assert.deepEqual(rows.map(r=>[r.lineId,r.previous.duration_ms,r.current.duration_ms]),[['l1',1500,1200]]);
});
test('길이 차이는 잴 수 있는 만큼만 말한다',()=>{
 assert.deepEqual(lengthChange(3200,2600),{kind:'shorter',previousSec:3.2,currentSec:2.6,diffSec:0.6});
 assert.deepEqual(lengthChange(2000,2900),{kind:'longer',previousSec:2,currentSec:2.9,diffSec:0.9});
 assert.equal(lengthChange(3000,3250).kind,'same');
 assert.equal(lengthChange(10000,10800).kind,'same');
});
