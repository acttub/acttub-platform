import test from 'node:test';
import assert from 'node:assert/strict';
import { reminderOpenEvent, reminderTarget } from '../lib/reminder-target.ts';
const id='12345678-1234-1234-1234-123456789abc';
const id2='abcdef01-2345-6789-abcd-ef0123456789';
test('마저 하기 알림은 해당 회차 액티 화면을 연다',()=>{
 assert.equal(reminderTarget({kind:'evening_reminder',reminder_kind:'resume',practice_id:id}),'/coach?practiceId='+id);
});
test('기존 리마인드와 잘못된 id는 홈, 다른 푸시는 별도 처리한다',()=>{
 for(const practice_id of [null,undefined,'/bad',12,'']) assert.equal(reminderTarget({kind:'evening_reminder',reminder_kind:'resume',practice_id}),'/(tabs)');
 assert.equal(reminderTarget({kind:'evening_reminder'}),'/(tabs)');
 for(const value of [null,undefined,3,'x',{}, {kind:'analysis_done'}]) assert.equal(reminderTarget(value),null);
});
test('분석 완료 알림은 그 회차를 연다(SOMA-844)',()=>{
 assert.equal(reminderTarget({kind:'analysis_complete',practice_id:id}),'/coach?practiceId='+id);
 for(const practice_id of [null,'/bad',12]) assert.equal(reminderTarget({kind:'analysis_complete',practice_id}),null);
});
test('연습 알림은 알림이 말한 대상을 연다(SOMA-862)',()=>{
 assert.equal(reminderTarget({kind:'evening_reminder',reminder_kind:'homework',practice_id:id}),`/reminder-open?kind=homework&id=${id}`);
 assert.equal(reminderTarget({kind:'evening_reminder',reminder_kind:'pending_video',video_id:id2}),`/reminder-open?kind=pending_video&id=${id2}`);
 assert.equal(reminderTarget({kind:'evening_reminder',reminder_kind:'unread_script',script_id:id2}),`/reminder-open?kind=unread_script&id=${id2}`);
 assert.equal(reminderTarget({kind:'evening_reminder',reminder_kind:'first_practice'}),'/reading/sample');
 assert.equal(reminderTarget({kind:'evening_reminder',reminder_kind:'first_nudge'}),'/reading/sample');
 assert.equal(reminderTarget({kind:'evening_reminder',reminder_kind:'exam'}),'/reading/sample?exam=1');
});
test('대상 id가 없거나 이상하면 홈, 일반·연속 기록 알림도 홈이다',()=>{
 assert.equal(reminderTarget({kind:'evening_reminder',reminder_kind:'homework'}),'/(tabs)');
 assert.equal(reminderTarget({kind:'evening_reminder',reminder_kind:'pending_video',video_id:'../x'}),'/(tabs)');
 assert.equal(reminderTarget({kind:'evening_reminder',reminder_kind:'unread_script',script_id:12}),'/(tabs)');
 assert.equal(reminderTarget({kind:'evening_reminder',reminder_kind:'pending_video',practice_id:id}),'/(tabs)');
 for(const reminder_kind of ['general','reading','streak','new_kind']) assert.equal(reminderTarget({kind:'evening_reminder',reminder_kind}),'/(tabs)');
});
test('연습 알림을 누르면 종류별로 남긴다',()=>{
 assert.deepEqual(reminderOpenEvent({kind:'evening_reminder',reminder_kind:'homework',practice_id:id,template_id:'hw.a'}),{reminder_kind:'homework',template_id:'hw.a',target:'resolve'});
 assert.deepEqual(reminderOpenEvent({kind:'evening_reminder',reminder_kind:'first_nudge'}),{reminder_kind:'first_nudge',template_id:'',target:'/reading/sample'});
 assert.deepEqual(reminderOpenEvent({kind:'evening_reminder'}),{reminder_kind:'unknown',template_id:'',target:'home'});
 assert.equal(reminderOpenEvent({kind:'analysis_complete',practice_id:id}),null);
 assert.equal(reminderOpenEvent(null),null);
});
