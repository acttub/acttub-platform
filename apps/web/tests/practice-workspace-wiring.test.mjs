// practice.record·library·start·resume·analyze — 워크스페이스 화면(D4~D8)의 배선.
// 이 화면은 next/link 를 들고 있어 Node 에서 렌더하지 못한다. 규칙 자체는
// tests/practice-library-rules.test.mjs 와 각 API 테스트가 실행으로 지키고, 여기서는
// 그 규칙이 화면의 어느 자리에 이어져 있는지만 본다.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const appRoot = path.resolve(import.meta.dirname, "..");
const source = readFileSync(
  path.join(appRoot, "src/features/workspace/workspace-app.tsx"),
  "utf8",
);

function block(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${endMarker} 를 찾지 못했다`);
  return source.slice(start, end);
}

test("practice.start: 웹 새 연습에 이론 선택이 없다", () => {
  // 고르는 자리도, 고른 것을 싣는 자리도 남지 않았다. 계측 속성까지 같이 본다 —
  // 화면만 지우고 payload 가 남으면 서버에는 여전히 그 값이 간다.
  assert.equal(
    existsSync(path.join(appRoot, "src/features/practice/theory-choice.ts")),
    false,
  );
  assert.doesNotMatch(source, /theory|Theory|이론/);
  const analytics = readFileSync(path.join(appRoot, "src/lib/analytics/amplitude.ts"), "utf8");
  assert.doesNotMatch(analytics, /theory_choice/);
});

test("practice.start: 게스트는 시작 버튼을 누르기 전에 하루 3회 한도를 본다", () => {
  const start = block("{body.footer.kind === \"start\" ? (", "<BlockageFields");
  const noticeAt = start.indexOf("guestAnalysisNotice(guestUsed)");
  const startRowAt = start.indexOf("<StartRow");
  assert.ok(noticeAt !== -1, "게스트 안내를 찾지 못했다");
  assert.ok(noticeAt < startRowAt, "안내가 시작 버튼 뒤에 있다");

  // 시작이 성공한 회차만 센다. 429 로 막힌 시도까지 세면 남은 횟수가 실제보다 빨리 준다.
  const begin = block("const begin = useCallback", "const send = useCallback");
  const successAt = begin.indexOf("const { practice, durationMs, compressionRan } = started;");
  assert.ok(successAt !== -1, "시작 성공 자리를 찾지 못했다");
  assert.ok(begin.indexOf("recordGuestAnalysis()") > successAt);
});

test("practice.start: 장면 세 칸은 300자에서 멈춘다", () => {
  const sceneField = block("function SceneField({", "function StartRow({");
  assert.match(sceneField, /maxLength=\{SCENE_FIELD_MAX\}/);
});

test("practice.resume: 진행 중 회차가 있다는 답(409)을 받으면 그 회차로 돌아간다", () => {
  const begin = block("const begin = useCallback", "const send = useCallback");
  assert.match(begin, /if \(started\.inProgress\) void returnToInProgressRef\.current\(continueFrom\?\.id\)/);

  // 돌아갈 회차 id 는 묶음 조회에서 얻는다 — 409 본문에는 코드만 온다.
  const ret = block("returnToInProgressRef.current = async", "}, [openSession]);");
  assert.match(ret, /await listPracticeGroups\(\)/);
  assert.match(ret, /inProgressPracticeId\(latest, rootId\)/);
  assert.match(ret, /await openSession\(id\)/);
});

test("practice.resume: 같은 영상으로 이어하면 올리지 않고 보관함 영상을 그대로 쓴다", () => {
  const continueFromCurrent = block(
    "const continueFromCurrent = useCallback",
    "const view = describeWorkspaceView",
  );
  assert.match(continueFromCurrent, /libraryId: detail\.video_id/);
  // 파일만 파기한 영상으로는 이어갈 수 없다(422 video_not_ready 를 미리 막는다).
  assert.match(continueFromCurrent, /!detail\.video_purged/);

  // 보관함 영상은 올릴 것이 없어 곧바로 회차를 만든다.
  const library = block("const startLibraryVideo = useCallback", "const begin = useCallback");
  assert.match(library, /Promise\.resolve\(\{ videoId: video\.libraryId/);
});

test("practice.analyze: 화면은 회차 상태를 폴링하고 그만두기는 취소를 보낸다", () => {
  // 간격은 클라이언트가 들고 있다(웹 10초). 그 값은 tests/practice-practices-api 가 실행으로 지킨다.
  const track = block("const trackAnalysis = useCallback", "const retryAnalysis");
  assert.match(track, /pollPracticeUntilSettled\(practiceSessionId, \{/);
  assert.doesNotMatch(track, /intervalMs:/);

  // "그만두기" 는 명시적 취소다 — 화면을 떠나는 길(abort)과 다른 자리여야 한다.
  const cancel = block("const cancelAnalysis = async", "const [analysisRetrying");
  assert.match(cancel, /await cancelPractice\(sessionId\)/);
  const panel = block("function ProgressPanel", "function IntroLine");
  assert.match(panel, /그만두기/);
  assert.match(panel, /화면을 떠나도 살펴보는 일은 계속돼요/);
  assert.doesNotMatch(panel, /분석 중|평가 중|점수|리포트/);
});

test("practice.analyze: 일부 구간을 못 본 회차는 그 사실을 장면 자리에서 알린다", () => {
  const scene = block("function ScenePanel({", "function SceneRows({");
  assert.match(scene, /analysisNotice\(detail\.analysis_status\)/);
  assert.match(scene, /\{partialNotice\}/);
});

test("practice.library: 지난 연습은 묶음·회차로 서고 달마다 나뉘며 최근 30일로 좁힐 수 있다", () => {
  const rail = block("const SessionRail = memo", "function RailSection({");
  assert.match(rail, /byMonth\(finished\)\.map\(\(section\)/);
  assert.match(rail, /onClick=\{onToggleRecent\}/);
  assert.match(rail, /회차 \$\{g\.practices\.length\}개 펼치기/);
  // 회차를 여는 것은 회차 id 다 — 묶음 id 로 열면 늘 1차만 열린다.
  assert.match(rail, /onClick=\{\(\) => onOpen\(practice\.id\)\}/);

  // 목록은 서버가 준 묶음을 그대로 쓴다. 옛 화면이 하던 continued_from 재구성은 없다.
  assert.doesNotMatch(source, /continued_from/);
  assert.match(source, /const \{ groups: loaded \} = await listPracticeGroups\(\);/);
});

test("practice.library: 삭제 자리는 묶음 숨김이고 무엇이 남는지 말한다", () => {
  assert.match(source, /\{HIDE_GROUP_COPY\}/);
  const remove = block("const removeSession = useCallback", "const noteBySession");
  assert.match(remove, /rootId: detail\?\.root_id/);
});

test("practice.record·library: 보관함으로 가는 길이 있고 보관함 영상으로 새 연습을 시작한다", () => {
  assert.match(source, /href="\/library"/);
  const entry = block("const videoParam = searchParams.get(\"video\")", "// 주소에 ?session= 이 실려 오면");
  assert.match(entry, /getVideo\(videoParam\)/);
  assert.match(entry, /type: "videoPicked"/);
  // 파기된 영상은 들고 서지 않는다.
  assert.match(entry, /video\.purged_at/);
});

test("practice.record: 마무리 전 영상이 있으면 탭을 닫을 때 경고한다", () => {
  assert.match(source, /guardUnfinishedUpload\(typeof window === "undefined" \? null : window, uploading\)/);
  assert.match(source, /const uploading = screen\.kind === "uploading";/);
});
