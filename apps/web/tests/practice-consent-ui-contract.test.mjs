import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const appRoot = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFileSync(path.join(appRoot, relativePath), "utf8");

test("terms gate requires service and external AI consent while internal review stays optional and off", () => {
  const source = read("src/features/practice/terms-gate.tsx");
  assert.match(source, /useState\(false\)[\s\S]*serviceConsent/);
  assert.match(source, /useState\(false\)[\s\S]*aiProcessingConsent/);
  assert.match(source, /const \[internalReviewConsent, setInternalReviewConsent\] = useState\(false\)/);
  assert.match(source, /!serviceConsent \|\| !aiProcessingConsent/);
  assert.match(source, /선택 동의는 꺼진 상태여도 서비스를 이용할 수 있어요/);
});

test("upload session confirmations gate canonical intent creation and safe errors", () => {
  const source = read("src/features/practice/practice-flow.tsx");
  assert.match(source, /!adultConfirmed \|\| !allParticipantsConfirmed/);
  assert.match(source, /adultConfirmed: true/);
  assert.match(source, /allParticipantsConfirmed: true/);
  assert.match(source, /영상은 5분 이내여야 해요/);
  assert.match(source, /영상 정보를 읽을 수 없어요/);
  assert.match(source, /동의 정보가 최신 상태가 아니에요/);
});
