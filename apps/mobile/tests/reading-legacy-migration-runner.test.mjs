import assert from 'node:assert/strict';
import { test } from 'node:test';

import { installLegacyRunnerFakes, LEGACY_SCRIPT } from './helpers/legacy-runner-hooks.mjs';

const s = installLegacyRunnerFakes();
s.storage.set('acttub.reading.scripts', JSON.stringify([LEGACY_SCRIPT]));
const { runLegacyScriptMigrationOnce } = await import('../lib/reading/legacy-migration-runner.ts');

test('앱 실행마다 한 번만 옛 대본을 서버로 옮기고, 녹음 파일은 지우며 외운 표시는 서버 줄로 옮긴다', async () => {
  const first = runLegacyScriptMigrationOnce();
  assert.equal(runLegacyScriptMigrationOnce(), first);

  assert.deepEqual(await first, { moved: 1, memorized: 1, limited: 0, failed: 0 });
  assert.equal(s.created.length, 1);
  assert.equal(s.created[0].title, '옥상, 밤');
  assert.match(s.created[0].request_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(s.memorized, [['srv_l2', 'memorized']]);
  assert.deepEqual(s.deleted, ['file:///old/rec1.m4a']);
  assert.equal(s.storage.has('acttub.reading.scripts'), false);
});
