import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { enterBlockageSelection } = await import(
  "../src/features/workspace/blockage-entry.ts"
);

function video() {
  return { file: new File(["scene"], "scene.mp4", { lastModified: 1 }) };
}

function recorder() {
  const calls = [];
  return {
    calls,
    entry(picked) {
      return {
        video: picked,
        startUpload: (file) => calls.push(`upload:${file.name}`),
        goToBlockage: () => calls.push("blockage"),
        track: () => calls.push("track"),
      };
    },
  };
}

test("압축·업로드를 막힘 화면으로 넘어가기 전에 띄운다", () => {
  const { calls, entry } = recorder();

  enterBlockageSelection(entry(video()));

  // 뒤로 미루면 배우는 고르는 시간과 올리는 시간을 더해서 기다린다.
  assert.deepEqual(calls, ["upload:scene.mp4", "blockage", "track"]);
});

test("배우가 고른 그 영상을 올린다", () => {
  const started = [];
  const picked = video();

  enterBlockageSelection({
    video: picked,
    startUpload: (file) => started.push(file),
    goToBlockage: () => undefined,
    track: () => undefined,
  });

  assert.deepEqual(started, [picked.file]);
});

test("영상이 없으면 아무것도 하지 않는다", () => {
  const { calls, entry } = recorder();

  enterBlockageSelection(entry(null));

  // 막힘 화면은 영상 없이 설 수 없다 — 그 화면이 자기 영상을 들고 있다.
  assert.deepEqual(calls, []);
});
