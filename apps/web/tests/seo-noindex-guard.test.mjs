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

// 색인을 허용하는 공개 페이지. 여기 없는 page는 전부 noindex여야 한다.
// 새 주소를 색인시키려면 이 표에 넣고 sitemap에도 같이 넣는다.
const INDEXABLE_PAGES = [
  { page: "page.tsx", builder: "buildLandingMetadata" },
  { page: path.join("app", "page.tsx"), builder: "buildAppDownloadMetadata" },
];

const indexablePagePaths = new Set(
  INDEXABLE_PAGES.map(({ page }) => path.join(sourceAppRoot, page)),
);

test("색인 허용 목록에 없는 모든 page는 자신 또는 같은 segment layout에서 noindex를 export한다", () => {
  const uncovered = [];

  for (const pagePath of collectPages(sourceAppRoot)) {
    if (indexablePagePaths.has(pagePath)) continue;

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

test("색인 허용 페이지는 noindex 없이 자기 metadata builder를 export한다", () => {
  for (const { page, builder } of INDEXABLE_PAGES) {
    const source = readSource(path.join(sourceAppRoot, page));

    assert.doesNotMatch(source, /buildNoindexMetadata/, page);
    assert.match(
      source,
      new RegExp(`\\bexport\\s+const\\s+metadata\\s*=\\s*${builder}\\s*\\(`),
      page,
    );
  }
});

test("llms.txt는 존재하고 서비스 도메인을 안내한다", () => {
  const llmsPath = path.join(appRoot, "public", "llms.txt");

  assert.equal(existsSync(llmsPath), true);
  if (!existsSync(llmsPath)) return;

  const content = readSource(llmsPath);
  assert.notEqual(content.trim(), "");
  assert.match(content, /acttub\.com/);
});
