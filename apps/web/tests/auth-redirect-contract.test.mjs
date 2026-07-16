import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const appRoot = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFileSync(path.join(appRoot, relativePath), "utf8");

function loadOAuthNextHelper() {
  const source = read("src/app/auth/oauth-next.ts");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const cjsModule = { exports: {} };
  vm.runInNewContext(transpiled, { module: cjsModule, exports: cjsModule.exports, URL }, { filename: "oauth-next.ts" });
  return cjsModule.exports;
}

test("OAuth next sanitizer preserves only allowlisted same-origin relative practice paths", () => {
  const { sanitizeOAuthNextPath } = loadOAuthNextHelper();

  assert.equal(sanitizeOAuthNextPath(null), "/home");
  assert.equal(sanitizeOAuthNextPath("/home"), "/home");
  assert.equal(sanitizeOAuthNextPath("/practice/new"), "/practice/new");
  assert.equal(sanitizeOAuthNextPath("/practice/history?tab=mine#latest"), "/practice/history?tab=mine#latest");

  for (const unsafe of [
    "https://evil.example/phish",
    "//evil.example/phish",
    "/\\evil.example/phish",
    "/practice\\..\\auth",
    "/practice",
    "javascript:alert(1)",
    "http:evil.example",
    "\\\\evil.example\\phish",
    "/%2f%2fevil.example/phish",
    "/practice%5c..%5cauth",
    "/auth/callback?next=https://evil.example",
    "/terms",
  ]) {
    assert.equal(sanitizeOAuthNextPath(unsafe), "/home", `${unsafe} must not round-trip`);
  }
});

test("OAuth login and callback routes sanitize next before using it", () => {
  const login = read("src/app/auth/login/route.ts");
  const callback = read("src/app/auth/callback/route.ts");

  assert.match(login, /sanitizeOAuthNextPath\(request\.nextUrl\.searchParams\.get\("next"\)\)/);
  assert.match(callback, /sanitizeOAuthNextPath\(requestUrl\.searchParams\.get\("next"\)\)/);
  assert.doesNotMatch(login, /searchParams\.get\("next"\) \?\? "\/home"/);
  assert.doesNotMatch(callback, /searchParams\.get\("next"\) \?\? "\/home"/);
});
