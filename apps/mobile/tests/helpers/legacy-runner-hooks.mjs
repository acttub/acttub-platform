import { registerHooks } from 'node:module';

/**
 * 옛 대본 옮기기 배선(legacy-migration-runner)의 기기 저장소·리딩 API·파일 삭제를 globalThis.__legacyRunnerTest 의
 * 기억 속 가짜로 바꾼다. 옮기는 규칙(legacy-migration)과 요청 id 는 진짜를 쓴다.
 */
export function installLegacyRunnerFakes() {
  const s = {
    storage: new Map(),
    setFails: false,
    created: [],
    memorized: [],
    deleted: [],
  };
  globalThis.__legacyRunnerTest = s;
  const fakes = {
    '@react-native-async-storage/async-storage': `const s = globalThis.__legacyRunnerTest;
      export default {
        getItem: async (k) => s.storage.get(k) ?? null,
        setItem: async (k, v) => { if (s.setFails) throw new Error('disk full'); s.storage.set(k, v); },
        removeItem: async (k) => { s.storage.delete(k); },
      };`,
    '@/lib/account-files': `export async function deleteDeviceFile(uri) { globalThis.__legacyRunnerTest.deleted.push(uri); }`,
    '@/lib/api': `const s = globalThis.__legacyRunnerTest;
      export const api = {
        async createReadingScript(body) {
          s.created.push(body);
          return { id: 'srv1', lines: body.lines.map((l) => ({ id: 'srv_l' + l.ordinal, ordinal: l.ordinal, kind: l.kind })) };
        },
        async setLineMemorization(lineId, status) { s.memorized.push([lineId, status]); },
      };`,
  };
  registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL?.endsWith('/reading/legacy-migration-runner.ts')) {
        if (fakes[specifier]) return { url: `data:text/javascript,${encodeURIComponent(fakes[specifier])}`, shortCircuit: true };
        if (specifier.startsWith('@/')) return next(new URL(`../../${specifier.slice(2)}.ts`, import.meta.url).href, context);
      }
      return next(specifier, context);
    },
  });
  return s;
}

export const LEGACY_SCRIPT = {
  id: 'old1',
  title: '옥상, 밤',
  roles: ['윤서', '태오'],
  lines: [
    { type: 'dialogue', role: '윤서', text: '여기 있을 줄 알았어.' },
    { type: 'dialogue', role: '태오', text: '어떻게 알았어.' },
  ],
  memorized: [1],
  recordings: [{ uri: 'file:///old/rec1.m4a' }],
};
