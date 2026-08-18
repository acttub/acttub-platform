import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { uploadForCurrentFile } = await import(
  "../src/features/workspace/pending-video-upload.ts"
);
const workspace = readFileSync(
  path.resolve(
    import.meta.dirname,
    "../src/features/workspace/workspace-app.tsx",
  ),
  "utf8",
);

function pendingUpload(file) {
  return {
    file,
    controller: new AbortController(),
    promise: Promise.resolve(file),
  };
}

test("파일 A로 업로드를 시작한 뒤 B로 바꿔 제출하면 B를 업로드한다", async () => {
  const fileA = new File(["old video"], "scene-a.mp4", { lastModified: 1 });
  const fileB = new File(["new video"], "scene-b.mp4", { lastModified: 2 });
  const pendingA = pendingUpload(fileA);
  const startedFiles = [];

  const selected = uploadForCurrentFile(pendingA, fileB, (file) => {
    startedFiles.push(file);
    return pendingUpload(file);
  });

  assert.equal(pendingA.controller.signal.aborted, true);
  assert.deepEqual(startedFiles, [fileB]);
  assert.equal(selected.file, fileB);
  assert.equal(await selected.promise, fileB);
});

test("제출은 현재 영상에 맞는 업로드를 고른다", () => {
  const beginStart = workspace.indexOf("const begin = useCallback");
  const beginEnd = workspace.indexOf("const send = useCallback", beginStart);
  const begin = workspace.slice(beginStart, beginEnd);

  // 그 영상은 이제 막힘 선택 화면이 들고 있다 — 어느 화면이 무엇을 드는지는
  // tests/workspace-state.test.mjs 가 실행으로 지킨다.
  assert.match(
    begin,
    /uploadForCurrentFile\(\s*pendingUploadRef\.current,\s*video\.file,\s*startUpload/,
  );
});

test("현재 파일로 시작한 업로드는 중복으로 시작하지 않고 이어받는다", () => {
  const file = new File(["video"], "scene.mp4", { lastModified: 1 });
  const pending = pendingUpload(file);
  let starts = 0;

  const selected = uploadForCurrentFile(pending, file, (nextFile) => {
    starts += 1;
    return pendingUpload(nextFile);
  });

  assert.equal(selected, pending);
  assert.equal(starts, 0);
  assert.equal(pending.controller.signal.aborted, false);
});
