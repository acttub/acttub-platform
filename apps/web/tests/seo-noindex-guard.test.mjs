import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { test } from "node:test";

const appRoot = path.resolve(import.meta.dirname, "..");
const sourceAppRoot = path.join(appRoot, "src", "app");
const metadataExport =
  /\bexport\s+const\s+metadata\s*=\s*buildNoindexMetadata\s*\(/;

function collectPages(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const absolutePath = path.join(directory, entry);
    if (statSync(absolutePath).isDirectory()) return collectPages(absolutePath);
    return entry === "page.tsx" ? [absolutePath] : [];
  });
}

function readSource(absolutePath) {
  return readFileSync(absolutePath, "utf8");
}

test("랜딩을 제외한 모든 page는 자신 또는 같은 segment layout에서 noindex를 export한다", () => {
  const uncovered = [];

  for (const pagePath of collectPages(sourceAppRoot)) {
    if (pagePath === path.join(sourceAppRoot, "page.tsx")) continue;

    const layoutPath = path.join(path.dirname(pagePath), "layout.tsx");
    const pageCovered = metadataExport.test(readSource(pagePath));
    const layoutCovered =
      existsSync(layoutPath) && metadataExport.test(readSource(layoutPath));

    if (!pageCovered && !layoutCovered) {
      uncovered.push(path.relative(appRoot, pagePath));
    }
  }

  assert.deepEqual(uncovered, []);
});

test("랜딩은 landing metadata만 export한다", () => {
  const landingSource = readSource(path.join(sourceAppRoot, "page.tsx"));

  assert.doesNotMatch(landingSource, /buildNoindexMetadata/);
  assert.match(
    landingSource,
    /\bexport\s+const\s+metadata\s*=\s*buildLandingMetadata\s*\(/,
  );
});

test("llms.txt는 존재하고 서비스 도메인을 안내한다", () => {
  const llmsPath = path.join(appRoot, "public", "llms.txt");

  assert.equal(existsSync(llmsPath), true);
  if (!existsSync(llmsPath)) return;

  const content = readSource(llmsPath);
  assert.notEqual(content.trim(), "");
  assert.match(content, /acttub\.com/);
});
