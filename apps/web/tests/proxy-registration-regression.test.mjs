import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const webRoot = path.resolve(import.meta.dirname, "..");
const rootEntry = path.join(webRoot, "proxy.ts");
const srcEntry = path.join(webRoot, "src/proxy.ts");
const helperPath = path.join(webRoot, "src/lib/supabase/proxy.ts");
const matcher =
  "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)";

function loadTypeScriptModule(filename, stubs) {
  const source = readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  });
  const cjsModule = { exports: {} };
  const localRequire = (specifier) =>
    Object.hasOwn(stubs, specifier) ? stubs[specifier] : require(specifier);
  const wrapper = vm.runInThisContext(`(function (exports, require, module) {${compiled.outputText}\n})`, {
    filename,
  });
  wrapper(cjsModule.exports, localRequire, cjsModule);
  return cjsModule.exports;
}

function loadEntry() {
  const entry = existsSync(srcEntry) ? srcEntry : rootEntry;
  const calls = [];
  const helperResult = { delegated: true };
  const exports = loadTypeScriptModule(entry, {
    "@/lib/supabase/proxy": {
      updateSupabaseSession(request) {
        calls.push(request);
        return helperResult;
      },
    },
  });
  return { calls, exports, helperResult };
}

function loadHelper({ configured, getClaims }) {
  let clientOptions;
  const exports = loadTypeScriptModule(helperPath, {
    "@/lib/config/env": {
      getAppConfig: () => ({
        supabase: {
          anonKey: configured ? "anon-key" : "",
          isConfigured: configured,
          url: configured ? "https://example.supabase.co" : "",
        },
      }),
    },
    "@supabase/ssr": {
      createServerClient(_url, _key, options) {
        clientOptions = options;
        return { auth: { getClaims: () => getClaims(options) } };
      },
    },
  });
  return { clientOptions: () => clientOptions, updateSupabaseSession: exports.updateSupabaseSession };
}

test("Proxy convention entry is colocated with src/app", () => {
  assert.equal(existsSync(srcEntry), true, "apps/web/src/proxy.ts must exist");
  assert.equal(existsSync(rootEntry), false, "apps/web/proxy.ts must not exist");
});

test("entry exports named proxy, delegates once, and retains the exact matcher", async () => {
  const { calls, exports, helperResult } = loadEntry();
  const request = { url: "https://example.test/home" };

  assert.equal(typeof exports.proxy, "function");
  assert.equal(await exports.proxy(request), helperResult);
  assert.deepEqual(calls, [request]);
  assert.deepEqual(exports.config, { matcher: [matcher] });
});

test("installed Next matcher preserves the current inclusion and exclusion semantics", () => {
  globalThis.AsyncLocalStorage = AsyncLocalStorage;
  const { unstable_doesMiddlewareMatch } = require("next/experimental/testing/server.js");
  const { exports } = loadEntry();
  const matches = (url) =>
    unstable_doesMiddlewareMatch({ config: exports.config, nextConfig: {}, url });

  for (const url of [
    "/",
    "/home",
    "/practice/new",
    "/practice/history",
    "/auth/login",
    "/api/v1/auth/session",
    "/robots.txt",
    "/file.SVG",
  ]) assert.equal(matches(url), true, url);

  for (const url of [
    "/_next/static/chunks/app.js",
    "/_next/image?url=%2Ffile.svg&w=256&q=75",
    "/favicon.ico",
    "/file.svg",
    "/nested/photo.webp",
  ]) assert.equal(matches(url), false, url);
});

test("unconfigured Supabase fails closed only for protected practice pages", async () => {
  const { NextRequest } = require("next/server");
  const { updateSupabaseSession } = loadHelper({ configured: false, getClaims: null });

  for (const pathname of ["/home", "/practice/new", "/practice/history", "/practice/history/session-1"]) {
    const response = await updateSupabaseSession(new NextRequest(`https://example.test${pathname}`));
    assert.equal(response.status, 307, pathname);
    const location = new URL(response.headers.get("location"));
    assert.equal(location.pathname, "/auth/login");
    assert.equal(location.searchParams.get("next"), pathname);
  }

  for (const pathname of ["/", "/terms", "/auth/login", "/api/v1/auth/session"]) {
    const response = await updateSupabaseSession(new NextRequest(`https://example.test${pathname}`));
    assert.equal(response.status, 200, pathname);
    assert.equal(response.headers.has("location"), false, pathname);
  }
});

test("configured claims gate protected pages but leave API authorization to routes", async () => {
  const { NextRequest } = require("next/server");
  const cases = [
    { getClaims: async () => ({ data: { claims: {} }, error: null }), path: "/home", status: 307 },
    { getClaims: async () => ({ data: null, error: new Error("invalid") }), path: "/practice/new", status: 307 },
    { getClaims: async () => ({ data: { claims: { sub: "user-1" } }, error: null }), path: "/practice/history", status: 200 },
    { getClaims: async () => ({ data: { claims: {} }, error: null }), path: "/api/v1/practice-sessions", status: 200 },
  ];

  for (const fixture of cases) {
    let calls = 0;
    const { updateSupabaseSession } = loadHelper({
      configured: true,
      getClaims: async () => {
        calls += 1;
        return fixture.getClaims();
      },
    });
    const response = await updateSupabaseSession(new NextRequest(`https://example.test${fixture.path}`));
    assert.equal(calls, 1, fixture.path);
    assert.equal(response.status, fixture.status, fixture.path);
  }
});

test("claim refresh propagates request cookie, response cookie, and response headers", async () => {
  const { NextRequest } = require("next/server");
  const request = new NextRequest("https://example.test/home");
  const { clientOptions, updateSupabaseSession } = loadHelper({
    configured: true,
    getClaims: async (options) => {
      options.cookies.setAll(
        [{ name: "sb-session", value: "refreshed", options: { httpOnly: true, path: "/", sameSite: "lax" } }],
        { "Cache-Control": "private, no-store", "X-Refresh-Fixture": "propagated" },
      );
      return { data: { claims: { sub: "user-1" } }, error: null };
    },
  });

  const response = await updateSupabaseSession(request);

  assert.ok(clientOptions());
  assert.equal(request.cookies.get("sb-session")?.value, "refreshed");
  assert.equal(response.cookies.get("sb-session")?.value, "refreshed");
  assert.match(response.headers.get("set-cookie"), /sb-session=refreshed/);
  assert.match(response.headers.get("set-cookie"), /HttpOnly/i);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-refresh-fixture"), "propagated");
});
