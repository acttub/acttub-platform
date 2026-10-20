import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

// practice-api.mjs 와 같은 네이티브 경계 스텁이되, 파일 업로드 작업만 시험이 globalThis 로 갈아 끼운다.
// api.ts 를 practice-api.mjs 보다 먼저 불러 두어 두 헬퍼가 같은 api 인스턴스를 쓴다.
const nativeModules = {
  'expo-constants': 'export default { expoConfig: { version: "0.1.0" } };',
  'expo/fetch': 'export const fetch = async () => new Response("", { status: 404 });',
  'expo-file-system/legacy': 'export const FileSystemUploadType = { BINARY_CONTENT: 0 }; export const createUploadTask = (...args) => globalThis.__createUploadTask(...args);',
  'expo-secure-store': 'const values = new Map(); export const getItemAsync = async k => values.get(k) ?? null; export const setItemAsync = async (k,v) => { values.set(k,v); }; export const deleteItemAsync = async k => { values.delete(k); };',
};
registerHooks({
  resolve(specifier, context, next) {
    if (nativeModules[specifier]) return { url: `data:text/javascript,${encodeURIComponent(nativeModules[specifier])}`, shortCircuit: true };
    if (specifier.startsWith('@/')) specifier = new URL(`../../${specifier.slice(2)}.ts`, import.meta.url).href;
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const file = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(file)) specifier = file.href;
    }
    return next(specifier, context);
  },
});

export const { api } = await import('../../lib/api.ts');
export const tokenStore = await import('../../lib/token-store.ts');
export const { httpResponses, id, practice, video } = await import('./practice-api.mjs');

const spec = JSON.parse(readFileSync(new URL('../../../api/spec/openapi.json', import.meta.url), 'utf8'));

/** OpenAPI 스키마를 만족하는 가장 작은 값(필수 칸만, 배열은 한 개). 응답 본문 픽스처로 쓴다. */
export function sample(schemaOrName) {
  const schema = typeof schemaOrName === 'string' ? { $ref: `#/components/schemas/${schemaOrName}` } : schemaOrName;
  if (schema.$ref) {
    const name = schema.$ref.split('/').at(-1);
    return name === 'JsonNode' ? {} : sample(spec.components.schemas[name]);
  }
  const options = schema.anyOf ?? schema.oneOf;
  if (options) return sample(options.find(option => option.type !== 'null') ?? options[0]);
  if ('const' in schema) return schema.const;
  if (schema.enum) return schema.enum[0];
  switch (schema.type) {
    case 'object':
      return Object.fromEntries((schema.required ?? []).map(key => [key, sample(schema.properties[key])]));
    case 'array':
      return [sample(schema.items)];
    case 'string':
      if (schema.format === 'uuid') return id(1);
      if (schema.format === 'date-time') return '2026-10-20T00:00:00Z';
      if (schema.format === 'date') return '2026-10-20';
      return 'x';
    case 'integer':
    case 'number':
      return schema.minimum ?? 1;
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      return {};
  }
}

export function jwtWithSubject(subject) {
  const encode = value => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: subject })}.signature`;
}
