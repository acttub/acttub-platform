import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// SOMA-1037: 자동 넘김 판정 기록은 dev API 빌드의 폰 로그에만 남기고, 받아쓴 글 원문은 남기지 않는다.
test('자동 넘김 기록은 운영 API 빌드와 테스트에서 꺼져 있다', () => {
  const src = read('lib/reading/advance-log.ts');
  assert.match(src, /!isProductionApiUrl\(process\.env\.EXPO_PUBLIC_API_URL\) && !process\.env\.JEST_WORKER_ID/);
});

test('자동 넘김 기록에는 받아쓴 글 원문을 넣지 않고 글자 수만 넣는다', () => {
  for (const rel of ['app/reading/play.tsx', 'hooks/use-reading-stt.ts']) {
    const calls = read(rel).match(/logAdvance\([^;]*?\}\)/gs) ?? [];
    assert.ok(calls.length > 0, `${rel} 에 기록이 있다`);
    for (const call of calls) {
      assert.doesNotMatch(call, /(saidRef|text)\.current(?!\.length)(?!\s*\))/, `${rel}: ${call}`);
      assert.doesNotMatch(call, /turnText(?!,)/, `${rel}: ${call}`);
    }
  }
});
