import assert from 'node:assert/strict';
import { test } from 'node:test';

import { installLegacyRunnerFakes, LEGACY_SCRIPT } from './helpers/legacy-runner-hooks.mjs';

const s = installLegacyRunnerFakes();
s.storage.set('acttub.reading.scripts', JSON.stringify([{ ...LEGACY_SCRIPT, recordings: [] }]));
s.setFails = true;
const { runLegacyScriptMigrationOnce } = await import('../lib/reading/legacy-migration-runner.ts');

test('옮기다 기기 저장소에 못 쓰면 아무것도 옮기지 않은 결과로 끝내고 대본은 기기에 남긴다', async () => {
  assert.deepEqual(await runLegacyScriptMigrationOnce(), { moved: 0, memorized: 0, limited: 0, failed: 0 });
  assert.deepEqual(s.created, []);
  assert.equal(s.storage.has('acttub.reading.scripts'), true);
});
