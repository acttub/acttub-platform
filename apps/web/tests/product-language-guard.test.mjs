import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const appRoot = path.resolve(import.meta.dirname, "..");
const sourceRoot = path.join(appRoot, "src");
const generatedSchemaPath = path.join("src", "lib", "api", "v2-schema.d.ts");
const publicLlmsPath = path.join("public", "llms.txt");

const ignoredDirectories = new Set([".next", "node_modules"]);
const ignoredFiles = new Set([generatedSchemaPath]);
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

const legacyForbiddenSubstrings = [
  "점수",
  "등급",
  "약점",
  "개선점",
  "진단 결과",
  "피드백 카드",
  "score",
  "grade",
  "weakness",
  "diagnosis",
];

const legacySubstringRegressionCases = [
  ["점수", "앞점수뒤"],
  ["등급", "앞등급뒤"],
  ["약점", "앞약점뒤"],
  ["개선점", "앞개선점뒤"],
  ["진단 결과", "앞진단 결과뒤"],
  ["피드백 카드", "앞피드백 카드뒤"],
  ["score", "prefixSCOREsuffix"],
  ["grade", "prefixGRADEsuffix"],
  ["weakness", "prefixWEAKNESSsuffix"],
  ["diagnosis", "prefixDIAGNOSISsuffix"],
];

function findForbiddenProductLanguage(source) {
  const normalizedSource = source.toLowerCase();

  return [
    ...forbiddenProductLanguage
      .filter((pattern) => pattern.test(source))
      .map((pattern) => pattern.toString()),
    ...legacyForbiddenSubstrings
      .filter((term) => normalizedSource.includes(term.toLowerCase()))
      .map((term) => `substring "${term}"`),
  ];
}

function matchesForbiddenProductLanguage(source) {
  return findForbiddenProductLanguage(source).length > 0;
}

function collectFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const absolutePath = path.join(directory, entry);
    const relativePath = path.relative(appRoot, absolutePath);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      return ignoredDirectories.has(entry) ? [] : collectFiles(absolutePath);
    }

    if (ignoredFiles.has(relativePath)) return [];

    return scannedExtensions.has(path.extname(entry)) ? [relativePath] : [];
  });
}

function readSource(relativePath) {
  return readFileSync(path.join(appRoot, relativePath), "utf8");
}

function collectProductCopyFiles() {
  return [
    ...collectFiles(sourceRoot),
    ...(existsSync(path.join(appRoot, publicLlmsPath)) ? [publicLlmsPath] : []),
  ];
}

test("legacy substring guard catches every prior term inside longer text", () => {
  const missedTerms = legacySubstringRegressionCases
    .filter(([, source]) => !matchesForbiddenProductLanguage(source))
    .map(([term]) => term);

  assert.deepEqual(missedTerms, []);
});

test("generated v2 schema is excluded from the source scan", () => {
  assert.equal(collectFiles(sourceRoot).includes(generatedSchemaPath), false);
});

test("llms.txt is included in the product language scan", () => {
  assert.equal(collectProductCopyFiles().includes(publicLlmsPath), true);
});

test("user-facing source avoids score or verdict product language", () => {
  const matches = [];

  for (const file of collectProductCopyFiles()) {
    const source = readSource(file);

    for (const match of findForbiddenProductLanguage(source)) {
      matches.push(`${file} matched ${match}`);
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
