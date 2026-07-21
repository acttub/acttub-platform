import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const providersUrl = new URL(
  "../src/lib/auth/providers.ts",
  import.meta.url,
).href;
const { appleProvider, developmentProvider, googleProvider } =
  await import(providersUrl);

test("apple provider는 identityToken을 그대로 반환한다", async () => {
  const credential = "  apple-identity-token  ";

  assert.equal(appleProvider.name, "apple");
  assert.equal(await appleProvider.getIdToken({ credential }), credential);
});

test("apple provider는 credential이 없으면 거부한다", async () => {
  await assert.rejects(() => appleProvider.getIdToken(), /credential/);
});

test("google provider는 GIS credential을 그대로 반환한다", async () => {
  const credential = "  google-credential  ";

  assert.equal(googleProvider.name, "google");
  assert.equal(await googleProvider.getIdToken({ credential }), credential);
});

test("google provider는 credential이 없으면 거부한다", async () => {
  await assert.rejects(() => googleProvider.getIdToken(), /credential/);
});

test("development provider의 uid와 email 규약을 유지한다", async () => {
  assert.equal(developmentProvider.name, "development");
  assert.equal(
    await developmentProvider.getIdToken({
      uid: " user-1 ",
      email: " user@example.com ",
    }),
    "user-1:user@example.com",
  );
  assert.equal(
    await developmentProvider.getIdToken({ uid: " user-1 " }),
    "user-1",
  );
  await assert.rejects(
    () => developmentProvider.getIdToken({ uid: "   " }),
    /development 로그인에는 uid가 필요합니다/,
  );
});
