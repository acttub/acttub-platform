import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';

/**
 * 네이티브 경계만 바꾼다. stubs 의 키는 소스가 쓰는 import 문자열 그대로이고 값은 ESM 소스다.
 * 시험이 바꿀 상태는 globalThis 에 두고 스텁이 그것을 읽는다. 나머지 lib 모듈은 그대로 불러온다.
 */
export function stubModules(stubs) {
  registerHooks({
    resolve(specifier, context, next) {
      if (Object.hasOwn(stubs, specifier)) {
        return { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true };
      }
      if (specifier.startsWith('@/')) specifier = new URL(`../../${specifier.slice(2)}`, import.meta.url).href;
      if (/^(\.|file:)/.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
        const file = new URL(`${specifier}.ts`, context.parentURL);
        if (existsSync(file)) specifier = file.href;
      }
      return next(specifier, context);
    },
  });
}

/** AsyncStorage 와 같은 모양의 메모리 저장소. 스텁 소스에서 `globalThis.<name>` 으로 꺼내 쓴다. */
export function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
    removeItem: async key => { values.delete(key); },
    multiRemove: async keys => { for (const key of keys) values.delete(key); },
    getAllKeys: async () => [...values.keys()],
    clear: async () => { values.clear(); },
  };
}
