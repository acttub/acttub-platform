import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

// 샘플 파일은 앱 번들(Metro require)에 들어 있다. 전역 require 로 번들 모듈 번호 대신 파일 이름을 돌려준다.
globalThis.require = (id) => `module:${id.split('/').pop()}`;
globalThis.__voiceSampleTest = { downloaded: [], local: true };
const ASSET = `const s = globalThis.__voiceSampleTest;
  export const Asset = {
    fromModule(mod) {
      return {
        uri: 'https://bundle.test/' + mod,
        localUri: null,
        async downloadAsync() { s.downloaded.push(mod); if (s.local) this.localUri = 'file:///assets/' + mod; },
      };
    },
  };`;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'expo-asset' && context.parentURL?.endsWith('/reading/voice-samples.ts')) {
      return { url: `data:text/javascript,${encodeURIComponent(ASSET)}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const { cloudVoiceSampleUri } = await import('../lib/reading/voice-samples.ts');

test('프리셋의 앱 내장 샘플을 기기 파일로 꺼내 그 주소를 준다', async () => {
  assert.equal(await cloudVoiceSampleUri('F1'), 'file:///assets/module:voice-preview-f1.m4a');
  assert.equal(await cloudVoiceSampleUri('M5'), 'file:///assets/module:voice-preview-m5.m4a');
  assert.deepEqual(globalThis.__voiceSampleTest.downloaded, ['module:voice-preview-f1.m4a', 'module:voice-preview-m5.m4a']);
});

test('기기 파일이 없으면 번들 주소를 준다', async () => {
  globalThis.__voiceSampleTest.local = false;
  assert.equal(await cloudVoiceSampleUri('M2'), 'https://bundle.test/module:voice-preview-m2.m4a');
});
