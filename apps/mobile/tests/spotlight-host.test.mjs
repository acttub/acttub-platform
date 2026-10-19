import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stubModules } from './helpers/m4-stubs.mjs';

stubModules({});
const { currentSpotlight, onSpotlightChanged, showSpotlight } = await import('../lib/spotlight-host.ts');

test('화면이 맡긴 안내를 하나만 들고, 바뀔 때만 그리는 쪽에 알린다', () => {
  const seen = [];
  const stop = onSpotlightChanged(() => seen.push(currentSpotlight()?.topic ?? null));
  const request = { steps: [], topic: 'home', onDone: () => undefined };

  showSpotlight(request);
  showSpotlight(request);
  showSpotlight(null);
  stop();
  showSpotlight({ ...request, topic: 'reading' });

  assert.deepEqual(seen, ['home', null]);
  assert.equal(currentSpotlight().topic, 'reading');
});
