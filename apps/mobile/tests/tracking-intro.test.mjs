import test from 'node:test';
import assert from 'node:assert/strict';
import { beforeTrackingRequest } from '../lib/tracking-intro.ts';
for (const platform of ['android','web']) test(`${platform} does not read iOS permissions`, async () => {
  await beforeTrackingRequest({ platform, getStatus: () => assert.fail('status read') });
});
for (const status of ['granted','denied','restricted']) test(`${status} skips explainer`, async () => {
  await beforeTrackingRequest({ platform: 'ios', getStatus: async () => status, getSeen: () => assert.fail('storage read') });
});
test('unanswered iOS request waits for continue before persisting and system request', async () => {
 const events=[]; let proceed; const shown=new Promise(r=>proceed=r);
 const run=beforeTrackingRequest({platform:'ios',getStatus:async()=>'undetermined',getSeen:async()=>null,show:async()=>{events.push('intro');await shown;},markSeen:async()=>{events.push('seen');}}).then(()=>events.push('system'));
 await new Promise(r=>setImmediate(r)); assert.deepEqual(events,['intro']); proceed(); await run; assert.deepEqual(events,['intro','seen','system']);
});
test('seen intro is not shown again',async()=>{ await beforeTrackingRequest({platform:'ios',getStatus:async()=>'undetermined',getSeen:async()=>'1',show:()=>assert.fail('shown')}); });
test('storage failures do not block the permission request',async()=>{let shown=false; await beforeTrackingRequest({platform:'ios',getStatus:async()=>'undetermined',getSeen:async()=>{throw Error('storage');},show:async()=>{shown=true;},markSeen:async()=>{throw Error('storage');}});assert.equal(shown,true);});
