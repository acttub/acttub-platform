import test from 'node:test';
import assert from 'node:assert/strict';
import { reminderTarget } from '../lib/reminder-target.ts';
const id='12345678-1234-1234-1234-123456789abc';
test('마저 하기 알림은 해당 회차 액티 화면을 연다',()=>{
 assert.equal(reminderTarget({kind:'evening_reminder',reminder_kind:'resume',practice_id:id}),'/coach?practiceId='+id);
});
test('기존 리마인드와 잘못된 id는 홈, 다른 푸시는 별도 처리한다',()=>{
 for(const practice_id of [null,undefined,'/bad',12,'']) assert.equal(reminderTarget({kind:'evening_reminder',reminder_kind:'resume',practice_id}),'/(tabs)');
 assert.equal(reminderTarget({kind:'evening_reminder'}),'/(tabs)');
 for(const value of [null,undefined,3,'x',{}, {kind:'analysis_done'}]) assert.equal(reminderTarget(value),null);
});
