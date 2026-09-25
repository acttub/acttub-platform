import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

// Only native boundaries are replaced. api.ts, request/auth layers and screen rules run unchanged.
const nativeModules = {
  'expo-constants': 'export default { expoConfig: { version: "1.0.0" } };',
  'expo-file-system/legacy': 'export const FileSystemUploadType = { BINARY_CONTENT: 0 }; export const createUploadTask = () => { throw new Error("native upload is not part of this test"); };',
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
const spec = JSON.parse(readFileSync(new URL('../../../api/spec/openapi.json', import.meta.url), 'utf8'));

// A small validator for the subset used by these HTTP DTOs, including the public note union.
export function validate(value, schema, at = '$') {
  if (schema.$ref) {
    if (schema.$ref.endsWith('/JsonNode')) return;
    return validate(value, spec.components.schemas[schema.$ref.split('/').at(-1)], at);
  }
  if (schema.anyOf) {
    assert.ok(schema.anyOf.some(s => { try { validate(value, s, at); return true; } catch { return false; } }), `${at}: anyOf`);
    return;
  }
  if (schema.type === 'null') return assert.equal(value, null, at);
  if (schema.type === 'object') {
    assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `${at}: object`);
    for (const key of schema.required ?? []) assert.ok(Object.hasOwn(value, key), `${at}.${key}: required`);
    for (const [key, v] of Object.entries(value)) {
      if (schema.additionalProperties === false) assert.ok(schema.properties?.[key], `${at}.${key}: unknown`);
      if (schema.properties?.[key]) validate(v, schema.properties[key], `${at}.${key}`);
    }
  } else if (schema.type === 'array') {
    assert.ok(Array.isArray(value), `${at}: array`);
    value.forEach((v, i) => validate(v, schema.items, `${at}[${i}]`));
  } else if (schema.type === 'integer') assert.ok(Number.isInteger(value), `${at}: integer`);
  else if (schema.type) assert.equal(typeof value, schema.type, at);
  if (schema.enum) assert.ok(schema.enum.includes(value), `${at}: enum`);
  if ('const' in schema) assert.equal(value, schema.const, `${at}: const`);
  if (schema.format === 'uuid') assert.match(value, /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i, at);
  if (schema.maxLength) assert.ok([...value].length <= schema.maxLength, `${at}: maxLength`);
}

export function httpResponses(t, responses) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const path = new URL(url).pathname;
    const method = (init.method ?? 'GET').toLowerCase();
    const route = Object.keys(spec.paths).find(p => new RegExp(`^${p.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(path));
    assert.ok(route && spec.paths[route][method], `${method.toUpperCase()} ${path} must exist in server OpenAPI`);
    const operation = spec.paths[route][method];
    const requestSchema = operation.requestBody?.content?.['application/json']?.schema;
    if (requestSchema) validate(JSON.parse(init.body), requestSchema, 'request');
    const response = responses.shift();
    assert.ok(response, `unexpected ${method} ${path}`);
    if (response.path) assert.equal(path, response.path);
    const status = response.status ?? 200;
    const responseSchema = operation.responses[String(status)]?.content?.['application/json']?.schema;
    // CONTRACT §6-2: reason-code errors are not described by the validation-array schema.
    if (responseSchema && status < 400) validate(response.body, responseSchema, 'response');
    calls.push({ path, method, body: init.body ? JSON.parse(init.body) : null, headers: new Headers(init.headers), url: String(url) });
    return status === 204 ? new Response(null, { status }) : Response.json(response.body, { status });
  });
  t.after(() => assert.equal(responses.length, 0, 'all planned HTTP responses consumed'));
  return calls;
}

export const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const practice = (over = {}) => ({
  id: id(1), root_id: id(1), ordinal: 1, video_id: id(2), stage: 'conversing', close_reason: null,
  experience_version: 'three_layers_v1', situation: '이별 직후', character: '친구', goal: '붙잡기',
  blockage_category: '그 외', blockage_detail: '그 외', blockage_note: null, created_at: '2026-09-21T02:00:00Z',
  analysis_status: 'partial', conversation_id: null, conversation_status: null, conversation_count: 0,
  note_id: null, note_title: null, note_kind: null,
  job: { id: id(3), status: 'succeeded', failure_reason: null, attempt_count: 1 }, previous_conversations: [], ...over,
});
export const video = (over = {}) => ({
  id: id(2), duration_ms: 30_000, byte_size: 1024, content_type: 'video/mp4', favorite: false, purged_at: null,
  created_at: '2026-09-21T02:00:00Z', usage: { practice_count: 1, entry_count: 0 },
  playback_url: 'https://storage.test/signed.mp4', playback_expires_at: '2026-09-21T02:10:00Z', poster_url: null, ...over,
});
