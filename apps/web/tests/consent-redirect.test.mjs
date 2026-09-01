import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { createConsentRedirectHandler } = await import(
  "../src/features/auth/consent-redirect.ts"
);
const appRoot = path.resolve(import.meta.dirname, "..");

test("동시 consent-required 신호는 현재 query를 보존한 한 번의 이동으로 합친다", () => {
  const destinations = [];
  const handleConsentRequired = createConsentRedirectHandler(
    (destination) => destinations.push(destination),
    () => ({ pathname: "/practice", search: "?session=session-1" }),
  );

  handleConsentRequired();
  handleConsentRequired();
  handleConsentRequired();

  assert.deepEqual(destinations, [
    "/terms?next=%2Fpractice%3Fsession%3Dsession-1",
  ]);
});

test("이미 terms에 있으면 consent-required 이동을 만들지 않는다", () => {
  const destinations = [];
  const handleConsentRequired = createConsentRedirectHandler(
    (destination) => destinations.push(destination),
    () => ({ pathname: "/terms", search: "?next=%2Fpractice" }),
  );

  handleConsentRequired();

  assert.deepEqual(destinations, []);
});

test("403 복구는 이전 허용 판정을 버린 뒤 동의 화면으로 이동한다", () => {
  const calls = [];
  const handleConsentRequired = createConsentRedirectHandler(
    (destination) => calls.push(`replace:${destination}`),
    () => ({ pathname: "/home", search: "" }),
    () => calls.push("clear-entry"),
  );

  handleConsentRequired();
  handleConsentRequired();

  assert.deepEqual(calls, [
    "clear-entry",
    "replace:/terms?next=%2Fhome",
  ]);
});

test("root layout은 consent-required 전역 리스너를 마운트한다", () => {
  const layout = readFileSync(path.join(appRoot, "src/app/layout.tsx"), "utf8");
  const listener = readFileSync(
    path.join(appRoot, "src/features/auth/consent-redirect-listener.tsx"),
    "utf8",
  );

  assert.match(layout, /<ConsentRedirectListener\s*\/>/);
  assert.match(listener, /onSessionEvent/);
  assert.match(listener, /event !== "consent-required"/);
});
