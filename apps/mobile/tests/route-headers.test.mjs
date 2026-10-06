import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const appDir = path.resolve(import.meta.dirname, '..', 'app');

function routes(dir, prefix = '') {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name.startsWith('(') ? [] : routes(full, `${prefix}${name}/`);
    if (!name.endsWith('.tsx') || name.startsWith('_') || name.startsWith('+')) return [];
    return [{ route: `${prefix}${name.slice(0, -4)}`, file: full }];
  });
}

test('모든 화면은 헤더를 정한다 — 안 정하면 기본 헤더가 라우트 이름(예: "memory")을 제목으로 띄운다', () => {
  const layout = readFileSync(path.join(appDir, '_layout.tsx'), 'utf8');
  const missing = routes(appDir).filter(
    ({ route, file }) => !layout.includes(`name="${route}"`) && !readFileSync(file, 'utf8').includes('<Stack.Screen'),
  );
  assert.deepEqual(missing.map((m) => m.route), []);
});
