import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { beforeEach, test } from 'node:test';

// 고품질 목소리 받기의 서버 호출과 파일만 가짜로 바꾼다. 파일 이름 규칙(speech-key·speech-file)은 진짜를 쓴다.
globalThis.__cloudRuntimeTest = {};
const s = globalThis.__cloudRuntimeTest;
const fakes = {
  'expo-file-system': `const s = globalThis.__cloudRuntimeTest;
    export const Paths = { cache: { uri: 'file:///cache' } };
    export class File {
      constructor(dir, name) { this.uri = dir.uri + '/' + name; }
      get exists() { return s.files.has(this.uri); }
      static async downloadFileAsync(url, file) { s.downloads.push([url, file.uri]); s.files.add(file.uri); return file; }
    }`,
  '@/lib/api': `const s = globalThis.__cloudRuntimeTest;
    export const api = { async synthesizeCloudVoice(text, preset) { s.asked.push([text, preset]); return { audio_url: 'https://cdn.test/' + preset + '.mp3' }; } };`,
};
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/reading/cloud-voice-runtime.ts')) {
      if (fakes[specifier]) return { url: `data:text/javascript,${encodeURIComponent(fakes[specifier])}`, shortCircuit: true };
      if (specifier.startsWith('@/')) return next(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return next(specifier, context);
  },
});
const { synthesizeCloudSpeech } = await import('../lib/reading/cloud-voice-runtime.ts');

beforeEach(() => {
  Object.assign(s, { files: new Set(), downloads: [], asked: [] });
});

test('서버가 만든 음성을 대본 캐시에 받아 두고, 같은 문장·목소리는 다시 묻지 않는다', async () => {
  const first = await synthesizeCloudSpeech('  가지 마  ', 's1', 'F2');

  assert.match(first, /^file:\/\/\/cache\/.*s1.*$/);
  assert.deepEqual(s.asked, [['가지 마', 'F2']]);
  assert.deepEqual(s.downloads, [['https://cdn.test/F2.mp3', first]]);

  assert.equal(await synthesizeCloudSpeech('가지 마', 's1', 'F2'), first);
  assert.equal(s.asked.length, 1);

  const other = await synthesizeCloudSpeech('가지 마', 's1', 'M1');
  assert.notEqual(other, first);
  assert.equal(s.asked.length, 2);
});
