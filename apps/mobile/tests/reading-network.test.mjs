import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

globalThis.__networkTest = { state: null };
const NETWORK = `export const NetworkStateType = { NONE: 'NONE', UNKNOWN: 'UNKNOWN', CELLULAR: 'CELLULAR', WIFI: 'WIFI', BLUETOOTH: 'BLUETOOTH', ETHERNET: 'ETHERNET' };
  export async function getNetworkStateAsync() { const s = globalThis.__networkTest.state; if (s instanceof Error) throw s; return s; }`;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'expo-network' && context.parentURL?.endsWith('/reading/network.ts')) {
      return { url: `data:text/javascript,${encodeURIComponent(NETWORK)}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const { currentNetworkType } = await import('../lib/reading/network.ts');

test('연결 종류를 Wi-Fi·이동통신·없음·모름으로 나눈다', async () => {
  const kinds = [];
  for (const type of ['WIFI', 'ETHERNET', 'CELLULAR', 'NONE', 'BLUETOOTH', 'UNKNOWN']) {
    globalThis.__networkTest.state = { type };
    kinds.push(await currentNetworkType());
  }
  assert.deepEqual(kinds, ['wifi', 'wifi', 'cellular', 'none', 'unknown', 'unknown']);
});

test('연결 상태를 못 읽으면 모름으로 본다', async () => {
  globalThis.__networkTest.state = new Error('no module');
  assert.equal(await currentNetworkType(), 'unknown');
});
