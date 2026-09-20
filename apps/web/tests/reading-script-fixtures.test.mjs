// reading.script — 공통 검증 자료. 대본 샘플 20편(tests/reading/fixtures/*.txt)을 파서에 넣으면
// 옆의 기대 결과(*.json)와 같아야 한다. 앱(apps/mobile)의 파서 테스트가 같은 파일을 읽어 두 파서가
// 같은 배역·줄 종류·줄 수를 내는지 고정한다(요구사항 「검증 방법」: 블록·공백 형식과 제목 조건,
// 같은 샘플 20편을 웹·앱 파서에 넣으면 배역·줄 종류·줄 수가 같다).
//
// 기대 결과를 새로 쓰려면(파서 규칙을 바꿨을 때): UPDATE_READING_FIXTURES=1 node --test tests/reading-script-fixtures.test.mjs
// 그 뒤 바뀐 json 을 눈으로 확인한다. 자료의 모양은 tests/reading/fixtures/README.md 에 있다.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { parseScript } = await import("../src/lib/reading/script/parse.ts");

const dir = path.resolve(import.meta.dirname, "reading/fixtures");
const samples = readdirSync(dir).filter((f) => f.endsWith(".txt")).sort();
const update = process.env.UPDATE_READING_FIXTURES === "1";

/** 파서 출력을 JSON 으로 — title 이 없으면 null 이다(JSON 에 undefined 가 없다). */
function expectedShape(parsed) {
  return { title: parsed.title ?? null, roles: parsed.roles, lines: parsed.lines };
}

test("reading.script: 공통 검증 자료는 대본 샘플 20편이고 샘플마다 기대 결과가 있다", () => {
  assert.equal(samples.length, 20);
  for (const sample of samples) {
    const expected = path.join(dir, sample.replace(/\.txt$/, ".json"));
    if (update) continue;
    assert.doesNotThrow(() => readFileSync(expected), `${sample} 의 기대 결과가 없다`);
  }
});

for (const sample of samples) {
  test(`reading.script: 공통 검증 자료 ${sample} — 파서 결과가 기대 결과와 같다`, () => {
    const raw = readFileSync(path.join(dir, sample), "utf8");
    const actual = expectedShape(parseScript(raw));
    const expectedPath = path.join(dir, sample.replace(/\.txt$/, ".json"));
    if (update) {
      writeFileSync(expectedPath, `${JSON.stringify(actual, null, 2)}\n`);
      return;
    }
    const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
    assert.deepEqual(actual, expected);
  });
}
