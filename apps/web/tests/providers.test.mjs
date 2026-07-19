import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const loaderUrl = new URL("./ts-module-loader.mjs", import.meta.url).href;
const providersUrl = new URL(
  "../src/lib/auth/providers.ts",
  import.meta.url,
).href;

function callProvider(providerName, calls) {
  const source = `
    await import(${JSON.stringify(loaderUrl)});
    const { getLoginProvider } = await import(${JSON.stringify(providersUrl)});
    const provider = getLoginProvider();
    const calls = ${JSON.stringify(calls)};
    const results = [];

    for (const call of calls) {
      try {
        const value = await provider.getIdToken(...call.args);
        results.push({ status: "fulfilled", value });
      } catch (error) {
        results.push({
          status: "rejected",
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    process.stdout.write(JSON.stringify(results));
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", source],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        NEXT_PUBLIC_AUTH_PROVIDER: providerName,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout);
}

test("google provider는 GIS credential을 그대로 반환한다", () => {
  const credential = "  google-credential  ";

  assert.deepEqual(callProvider("google", [{ args: [{ credential }] }]), [
    { status: "fulfilled", value: credential },
  ]);
});

test("google provider는 credential이 없으면 거부한다", () => {
  const [result] = callProvider("google", [{ args: [] }]);

  assert.equal(result.status, "rejected");
  assert.match(result.reason, /credential/);
});

test("dev provider의 uid와 email 규약을 유지한다", () => {
  assert.deepEqual(
    callProvider("dev", [
      { args: [{ uid: " user-1 ", email: " user@example.com " }] },
      { args: [{ uid: " user-1 " }] },
      { args: [{ uid: "   " }] },
    ]),
    [
      { status: "fulfilled", value: "user-1:user@example.com" },
      { status: "fulfilled", value: "user-1" },
      {
        status: "rejected",
        reason: "dev 로그인에는 uid가 필요합니다.",
      },
    ],
  );
});
