import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const appRoot = path.resolve(import.meta.dirname, "..");
const workspace = readFileSync(
  path.join(appRoot, "src/features/workspace/workspace-app.tsx"),
  "utf8",
);
const blockageSelection = readFileSync(
  path.join(appRoot, "src/features/practice/blockage-selection.tsx"),
  "utf8",
);
const {
  clearPendingPracticeUpload,
  getPendingPracticeUpload,
  savePendingPracticeUpload,
} = await import("../src/features/workspace/pending-practice-upload.ts");

const USER_KEY = "acttub.user";
const PENDING_UPLOADS_KEY = "acttub.pending_practice_upload";
const user = (id) => JSON.stringify({ id, email: null, status: "active" });

test("완료한 업로드의 이어하기 정보를 저장하고 지운다", () => {
  const values = new Map();
  values.set(USER_KEY, user("user-1"));
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  };

  try {
    const pending = {
      intentId: "intent-1",
      fileName: "scene.mov",
      durationMs: 42_000,
      situation: "카페에서 오랜 친구를 만나요",
      character: "먼저 사과하고 싶은 사람이에요",
      goal: "관계를 다시 이어가고 싶어요",
      savedAt: Date.now(),
    };
    savePendingPracticeUpload(pending);
    assert.deepEqual(getPendingPracticeUpload(), pending);

    clearPendingPracticeUpload();
    assert.equal(getPendingPracticeUpload(), null);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("깨졌거나 장면이 빈 이어하기 정보는 버린다", () => {
  const values = new Map([
    [USER_KEY, user("user-1")],
    [PENDING_UPLOADS_KEY, JSON.stringify({
      "user-1": {
        intentId: "intent-1",
        fileName: "scene.mov",
        durationMs: 42_000,
        situation: "   ",
        character: "친구",
        goal: "관계를 잇기",
        savedAt: Date.now(),
      },
    })],
  ]);
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  };

  try {
    assert.equal(getPendingPracticeUpload(), null);
    assert.equal(values.has(PENDING_UPLOADS_KEY), false);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("이어하기 정보는 현재 계정에 저장한 값만 보여 준다", () => {
  const values = new Map([[USER_KEY, user("user-1")]]);
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  };
  const pending = {
    intentId: "intent-user-1",
    fileName: "scene.mov",
    durationMs: 42_000,
    situation: "카페에서 오랜 친구를 만나요",
    character: "먼저 사과하고 싶은 사람이에요",
    goal: "관계를 다시 이어가고 싶어요",
    savedAt: Date.now(),
  };

  try {
    savePendingPracticeUpload(pending);

    values.set(USER_KEY, user("user-2"));
    assert.equal(getPendingPracticeUpload(), null);

    values.delete(USER_KEY);
    savePendingPracticeUpload({ ...pending, intentId: "unknown-user" });
    assert.equal(getPendingPracticeUpload(), null);

    values.set(USER_KEY, user("user-1"));
    assert.deepEqual(getPendingPracticeUpload(), pending);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("7일보다 오래된 이어하기 정보는 현재 계정 표에서 버린다", () => {
  const values = new Map([[USER_KEY, user("user-1")]]);
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  };

  try {
    savePendingPracticeUpload({
      intentId: "intent-old",
      fileName: "old-scene.mov",
      durationMs: 42_000,
      situation: "카페에서 오랜 친구를 만나요",
      character: "먼저 사과하고 싶은 사람이에요",
      goal: "관계를 다시 이어가고 싶어요",
      savedAt: Date.now() - 7 * 24 * 60 * 60 * 1000 - 1,
    });

    assert.equal(getPendingPracticeUpload(), null);
    assert.equal(values.has(PENDING_UPLOADS_KEY), false);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("질문 화면 진입과 업로드를 겹치고 완료 시에는 기존 Promise를 기다린다", () => {
  const startBlockageStart = workspace.indexOf("const startBlockage = useCallback");
  const resumeStart = workspace.indexOf("const resumePendingPractice", startBlockageStart);
  const startBlockage = workspace.slice(startBlockageStart, resumeStart);
  assert.match(
    startBlockage,
    /startVideoUpload\(videoFile\)[\s\S]*setMode\("blockage"\)/,
  );

  const beginStart = workspace.indexOf("const begin = useCallback");
  const beginEnd = workspace.indexOf("const send = useCallback", beginStart);
  const begin = workspace.slice(beginStart, beginEnd);
  assert.match(begin, /await initialUpload/);
  assert.match(begin, /catch \(firstError\)[\s\S]*startVideoUpload\(videoFile\)/);
  assert.doesNotMatch(begin, /prepareVideoUpload\(|uploadVideo\(/);
  assert.match(begin, /createPracticeSession[\s\S]*clearPendingPracticeUpload\(\)/);
});

test("영상과 장면 세 칸이 모두 있을 때만 시작하고 영상 없는 이어하기도 질문 화면을 연다", () => {
  assert.match(
    workspace,
    /ready=\{Boolean\([\s\S]*videoFile[\s\S]*situation\.trim\(\)[\s\S]*character\.trim\(\)[\s\S]*goal\.trim\(\)[\s\S]*\)\}/,
  );
  assert.match(workspace, /mode === "blockage" \? \(/);
  assert.doesNotMatch(workspace, /mode === "blockage" && videoUrl/);
  assert.match(blockageSelection, /videoUrl\?: string/);
  assert.match(blockageSelection, /올린 영상은 저장돼 있어요/);
});
