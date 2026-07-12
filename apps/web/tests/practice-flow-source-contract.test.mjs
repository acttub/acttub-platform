import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const appRoot = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFileSync(path.join(appRoot, relativePath), "utf8");

test("practice routes use explicit entry flow and legacy route redirects home", () => {
  assert.match(read("src/app/home/page.tsx"), /<PracticeFlow entry="home" \/>/);
  assert.match(read("src/app/practice/new/page.tsx"), /<PracticeFlow entry="new" \/>/);
  assert.match(read("src/app/practice/history/page.tsx"), /<PracticeFlow entry="history" \/>/);
  assert.match(read("src/app/practice/page.tsx"), /redirect\("\/home"\)/);
});

test("practice flow keeps the canonical analysis, interview, and report steps", () => {
  const source = read("src/features/practice/practice-flow.tsx");
  assert.match(source, /ANALYZING/);
  assert.match(source, /INTERVIEW/);
  assert.match(source, /REPORT/);
  assert.match(source, /END/);
  assert.match(source, /TV 드라마/);
  assert.match(source, /웹드라마/);
  assert.doesNotMatch(source, /finalActorSentence|OBSERVE_CONFIRM|PROBE_LOOP/);
});

test("selected video preview keeps a live blob URL until replacement or unmount", () => {
  const source = read("src/features/practice/practice-flow.tsx");
  const preview = source.match(
    /function SelectedUploadPreview[\s\S]*?(?=\nfunction AppLogoMark)/,
  )?.[0];

  assert.ok(preview, "expected SelectedUploadPreview component");
  assert.match(
    source,
    /const nextPreviewUrl = URL\.createObjectURL\(file\)[\s\S]*URL\.revokeObjectURL\(uploadPreviewUrlRef\.current\)[\s\S]*uploadPreviewUrlRef\.current = nextPreviewUrl[\s\S]*setUploadPreviewUrl\(nextPreviewUrl\)/,
  );
  assert.match(
    source,
    /useEffect\([\s\S]*\(\) => \(\) => \{[\s\S]*URL\.revokeObjectURL\(uploadPreviewUrlRef\.current\)/,
  );
  assert.doesNotMatch(preview, /URL\.createObjectURL|URL\.revokeObjectURL/);
  assert.match(preview, /controls[\s\S]*preload="metadata"[\s\S]*src=\{previewUrl\}[\s\S]*onError/);
  assert.match(source, /이 브라우저에서 선택한 영상을 재생할 수 없어요/);
});

test("interview is a one-question chat without manual completion", () => {
  const source = read("src/features/practice/practice-flow.tsx");

  assert.match(source, /role="log"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /AI 코치와 나눈 대화/);
  assert.doesNotMatch(source, /대화 종료하기|MIN_DIALOGUE_ANSWER_COUNT|MAX_DIALOGUE_ANSWER_COUNT/);
  assert.match(source, /restart/);
  assert.match(source, /acting_session_expired/);
});

test("one-click practice example fills every required scene field", () => {
  const source = read("src/features/practice/practice-flow.tsx");

  assert.match(source, /genre: "연극"/);
  assert.match(source, /situation: "시각장애인이 사랑하는 마음을 숨기는 상황"/);
  assert.match(source, /characterContext:\s*\n?\s*"[^"]+"/);
  assert.match(source, /테스트 예시 채우기/);
  assert.match(source, /onSceneChange\("characterContext", practiceExample\.characterContext\)/);
});
