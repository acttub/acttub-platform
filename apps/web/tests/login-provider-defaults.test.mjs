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
  assert.match(source, /login\("google", credential\)/);
  // uid만 보내고 email 배선이 끊겨도 초록이 되지 않도록 조립까지 고정한다.
  assert.match(
    source,
    /login\(\s*"development",\s*trimmedEmail \? `\$\{trimmedUid\}:\$\{trimmedEmail\}` : trimmedUid,?\s*\)/,
  );
  assert.match(
    source,
    /<GoogleLoginButton[\s\S]*process\.env\.NODE_ENV === "development"/,
  );
  assert.match(
    source,
    /const googleNotices = googleLoginNotices\(\s*inAppBrowser,\s*hasGoogleLoadFailed,\s*\)/,
  );
  assert.match(
    source,
    /onLoadError=\{\(\) => setHasGoogleLoadFailed\(true\)\}/,
  );
  assert.match(source, /개발용 테스트 로그인을 사용해요/);
});

test("Apple client ID is a code default without login env switches", () => {
  const source = readSource("src/lib/config/env.ts");

  assert.match(source, /export const APPLE_CLIENT_ID: string = /);
  assert.equal(
    source.includes(["NEXT", "PUBLIC", "APPLE", "CLIENT", "ID"].join("_")),
    false,
  );
});

test("login page gates the Apple button on a configured client ID", () => {
  const source = readSource("src/app/login/page.tsx");

  assert.match(source, /login\("apple", credential\)/);
  // Services ID 미설정 상태에서는 버튼이 렌더되지 않아야 한다.
  assert.match(source, /\{APPLE_CLIENT_ID \? \(\s*<AppleLoginButton/);
});

test("login page has one shared submit status region", () => {
  const source = readSource("src/app/login/page.tsx");

  assert.equal(
    occurrenceCount(
      source,
      /errorMessage \|\| googleNotices\.loadError \|\| noticeMessage/g,
    ),
    1,
  );
  assert.equal(occurrenceCount(source, /로그인 중\.\.\./g), 1);
});
