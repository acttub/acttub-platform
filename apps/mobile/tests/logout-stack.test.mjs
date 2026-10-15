import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('로그인이 풀리면 쌓인 화면을 다 닫고 로그인 화면 하나만 남긴다 — 뒤로 가기로 예전 화면에 가면 앱이 꺼졌다(SOMA-703)', () => {
  const root = read('app/_layout.tsx');
  // 탈퇴·로그아웃 뒤 맨 위 화면만 로그인으로 바꾸면 아래에 홈·설정이 남고, 로그인 화면에서 뒤로 가면 그 화면이
  // 나왔다가 다시 로그인으로 바뀌기를 되풀이하다 안드로이드에서 앱이 꺼졌다.
  assert.match(
    root,
    /if \(bootstrap\.route === '\/login' && !inLogin\) \{[\s\S]*?if \(router\.canDismiss\(\)\) router\.dismissAll\(\);\s*router\.replace\('\/login' as Href\);/,
  );
});
