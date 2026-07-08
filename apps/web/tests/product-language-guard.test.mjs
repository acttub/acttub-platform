import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const appRoot = path.resolve(import.meta.dirname, "..");
const sourceRoot = path.join(appRoot, "src");

const ignoredDirectories = new Set([".next", "node_modules"]);
const scannedExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".md", ".css"]);

const forbiddenProductLanguage = [
  /\bscore(?:s|d|ing)?\b/i,
  /\bverdicts?\b/i,
  /\bgrade(?:s|d|ing)?\b/i,
  /\bjudg(?:e|es|ed|ing|ment|ement)\b/i,
  /\brate(?:s|d|ing)?\b/i,
  /\blevels?\b/i,
  /\brank(?:s|ed|ing)?\b/i,
  /\bweakness(?:es)?\b/i,
  /\bimprovement(?:s)?\b/i,
  /\bdiagnos(?:is|es|tic)\b/i,
  /\bfeedback card(?:s)?\b/i,
  /점수/,
  /판정/,
  /채점/,
  /등급/,
  /레벨/,
  /랭킹/,
  /평가/,
  /평가표/,
  /결과 카드/,
  /강점/,
  /약점/,
  /개선점/,
  /진단 결과/,
  /피드백 카드/,
  /잘함/,
  /못함/,
];

function collectFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const absolutePath = path.join(directory, entry);
    const relativePath = path.relative(appRoot, absolutePath);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      return ignoredDirectories.has(entry) ? [] : collectFiles(absolutePath);
    }

    return scannedExtensions.has(path.extname(entry)) ? [relativePath] : [];
  });
}

function readSource(relativePath) {
  return readFileSync(path.join(appRoot, relativePath), "utf8");
}

test("user-facing source avoids score or verdict product language", () => {
  const matches = [];

  for (const file of collectFiles(sourceRoot)) {
    const source = readSource(file);

    for (const pattern of forbiddenProductLanguage) {
      if (pattern.test(source)) {
        matches.push(`${file} matched ${pattern}`);
      }
    }
  }

  assert.deepEqual(matches, []);
});

test("source does not re-use rejected observations in reflection context", () => {
  const riskyMatches = [];
  const rejectionNearbyReflection = /reject(?:ed|ion)?[\s\S]{0,160}(?:reflect|reflection|reuse|again|next|prompt|observation)|(?:reflect|reflection|reuse|again|next|prompt|observation)[\s\S]{0,160}reject(?:ed|ion)?/i;

  for (const file of collectFiles(sourceRoot)) {
    const source = readSource(file);

    if (rejectionNearbyReflection.test(source)) {
      riskyMatches.push(file);
    }
  }

  assert.deepEqual(riskyMatches, []);
});
