import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { mountProbe, react, window } from "./mount-probe.mjs";

const copyScript = path.resolve(import.meta.dirname, "../scripts/copy-pretendard.mjs");
const stylesheetId = "pretendard-dynamic-subset";
const { PretendardStylesheet } = await import("../src/app/pretendard-stylesheet.tsx");

function runCopyScript(cwd) {
  return spawnSync(process.execPath, [copyScript], { cwd, encoding: "utf8" });
}

async function makeFakePackage(root, subsetCount) {
  const packageRoot = path.join(root, "node_modules/pretendard");
  const variableRoot = path.join(packageRoot, "dist/web/variable");
  const subsetRoot = path.join(variableRoot, "woff2-dynamic-subset");
  await mkdir(subsetRoot, { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ version: "1.3.9" }),
  );

  const blocks = [];
  for (let subset = 0; subset < subsetCount; subset += 1) {
    blocks.push(`@font-face { font-display: swap; src: url(${subset}.woff2); }`);
    await writeFile(path.join(subsetRoot, `${subset}.woff2`), String(subset));
  }
  await writeFile(
    path.join(variableRoot, "pretendardvariable-dynamic-subset.css"),
    blocks.join("\n"),
  );
}

async function inTempDirectory(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "acttub-pretendard-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

afterEach(() => {
  window.document.getElementById(stylesheetId)?.remove();
});

test("동적 서브셋을 버전 경로에 복사하고 느린 첫 방문에는 폴백을 유지한다", async () => {
  await inTempDirectory(async (root) => {
    await makeFakePackage(root, 92);

    const result = runCopyScript(root);
    assert.equal(result.status, 0, result.stderr);

    const outputRoot = path.join(root, "public/fonts/pretendard/1.3.9");
    const css = await readFile(path.join(outputRoot, "pretendard.css"), "utf8");
    const fontFiles = await readdir(path.join(outputRoot, "woff2-dynamic-subset"));
    assert.equal(css.match(/font-display: optional;/g)?.length, 92);
    assert.equal(css.includes("font-display: swap;"), false);
    assert.equal(fontFiles.length, 92);
  });
});

test("Pretendard 원본이 없으면 자산 준비를 실패로 끝낸다", async () => {
  await inTempDirectory(async (root) => {
    const result = runCopyScript(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /pretendard 가 설치되어 있지 않다/);
  });
});

test("공식 동적 서브셋 수가 달라지면 조용히 불완전한 자산을 만들지 않는다", async () => {
  await inTempDirectory(async (root) => {
    await makeFakePackage(root, 91);

    const result = runCopyScript(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /동적 서브셋 수가 달라졌다: 91개/);
  });
});

function StylesheetProbe({ onRender }) {
  onRender(null);
  return react.createElement(PretendardStylesheet);
}

test("Pretendard 스타일시트를 한 번만 붙이고 로드 뒤 화면용으로 전환한다", () => {
  const first = mountProbe(StylesheetProbe);
  const second = mountProbe(StylesheetProbe);
  const stylesheets = window.document.querySelectorAll(`#${stylesheetId}`);

  assert.equal(stylesheets.length, 1);
  assert.equal(stylesheets[0].getAttribute("rel"), "stylesheet");
  assert.equal(
    stylesheets[0].getAttribute("href"),
    "/fonts/pretendard/1.3.9/pretendard.css",
  );
  assert.equal(stylesheets[0].media, "print");

  stylesheets[0].onload();
  assert.equal(stylesheets[0].media, "all");

  second.unmount();
  first.unmount();
});
