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
  assert.doesNotMatch(source, /label="매체"|label="장르"/);
  assert.doesNotMatch(source, /type SceneMedium|type SceneGenre/);
  assert.doesNotMatch(source, /finalActorSentence|OBSERVE_CONFIRM|PROBE_LOOP/);
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

test("completed analysis enters the interview without a manual start step", () => {
  const source = read("src/features/practice/practice-flow.tsx");
  const sessionView = source.slice(
    source.indexOf("function SessionView"),
    source.indexOf("function Report"),
  );

  assert.match(
    source,
    /const session = await createPracticeSession[\s\S]*setActive\(session\);[\s\S]*await operation\("start", session\)/,
  );
  assert.match(
    source,
    /const session = await retryPracticeAnalysis[\s\S]*setActive\(session\);[\s\S]*await operation\("start", session\)/,
  );
  assert.doesNotMatch(sessionView, />\s*인터뷰 시작\s*</);
});

test("answer input submits with Enter and renders an optimistic actor turn", () => {
  const source = read("src/features/practice/practice-flow.tsx");
  const reply = source.slice(
    source.indexOf("async function reply"),
    source.indexOf("async function retryReply"),
  );
  const sessionView = source.slice(
    source.indexOf("function SessionView"),
    source.indexOf("function Report"),
  );

  assert.match(source, /const \[pendingAnswer, setPendingAnswer\] = useState<string \| null>\(null\)/);
  assert.match(reply, /setPendingAnswer\(attempt\.context\.text\);[\s\S]*await mutatePracticeTurn/);
  assert.match(reply, /finally \{[\s\S]*setPendingAnswer\(null\)/);
  assert.match(sessionView, /pendingAnswer[\s\S]*pending-answer[\s\S]*나/);
  assert.match(
    sessionView,
    /onKeyDown=[\s\S]*event\.key === "Enter"[\s\S]*!event\.shiftKey[\s\S]*!event\.nativeEvent\.isComposing[\s\S]*event\.preventDefault\(\)[\s\S]*onReply\(\)/,
  );
});

test("acting coach header omits the new-practice shortcut", () => {
  const source = read("src/features/practice/practice-flow.tsx");
  const sessionView = source.slice(
    source.indexOf("function SessionView"),
    source.indexOf("function Report"),
  );

  assert.match(sessionView, /href="\/home"/);
  assert.doesNotMatch(sessionView, /href="\/practice\/new"/);
});
