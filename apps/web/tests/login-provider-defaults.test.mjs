import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const appRoot = path.resolve(import.meta.dirname, "..");

function readSource(relativePath) {
  return readFileSync(path.join(appRoot, relativePath), "utf8");
}

function occurrenceCount(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

test("Google client ID is a code default without login env switches", () => {
  const source = readSource("src/lib/config/env.ts");
  const removedNames = [
    ["NEXT", "PUBLIC", "AUTH", "PROVIDER"].join("_"),
    ["NEXT", "PUBLIC", "GOOGLE", "CLIENT", "ID"].join("_"),
    ["AUTH", "PROVIDER"].join("_"),
  ];

  assert.match(
    source,
    /export const GOOGLE_CLIENT_ID =\s*"462651930952-625pcnhrjib79r7990fqsdqhsterdij2\.apps\.googleusercontent\.com"/,
  );
  for (const name of removedNames) assert.equal(source.includes(name), false);
});

test("login page always renders Google and development form only in next dev", () => {
  const source = readSource("src/app/login/page.tsx");

  assert.doesNotMatch(source, /AUTH_PROVIDER|getLoginProvider/);
  assert.match(source, /loginWith\(googleProvider,\s*\{ credential \}\)/);
  assert.match(
    source,
    /loginWith\(developmentProvider,\s*\{ uid, email \}\)/,
  );
  assert.match(
    source,
    /<GoogleLoginButton[\s\S]*process\.env\.NODE_ENV === "development"/,
  );
  assert.match(source, /개발용 테스트 로그인을 사용해요/);
});

test("login page has one shared submit status region", () => {
  const source = readSource("src/app/login/page.tsx");

  assert.equal(
    occurrenceCount(source, /errorMessage \|\| noticeMessage/g),
    1,
  );
  assert.equal(occurrenceCount(source, /로그인 중\.\.\./g), 1);
});
