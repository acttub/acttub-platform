import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { installGlobalStorage } from './helpers/global-require-storage.mjs';

const state = installGlobalStorage();
const { AUTO_ADVANCE_TIP_KEY, hideAutoAdvanceTip, isAutoAdvanceTipHidden } = await import('../lib/reading/guide-flag.ts');

beforeEach(() => {
  state.items.clear();
  state.broken = false;
});

test('기기 저장소에 숨김 표시가 없으면 자동 넘김 안내를 띄우고, 다시 보지 않기를 남기면 숨긴다', async () => {
  assert.equal(await isAutoAdvanceTipHidden(), false);
  await hideAutoAdvanceTip();
  assert.equal(state.items.get(AUTO_ADVANCE_TIP_KEY), '1');
  assert.equal(await isAutoAdvanceTipHidden(), true);
});

test('저장소를 못 읽으면 숨긴 것으로 보고, 못 쓰면 조용히 넘어간다', async () => {
  state.broken = true;
  assert.equal(await isAutoAdvanceTipHidden(), true);
  await hideAutoAdvanceTip();
  assert.equal(state.items.size, 0);
});
