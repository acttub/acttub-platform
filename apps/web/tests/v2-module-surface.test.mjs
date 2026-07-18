import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const appRoot = path.resolve(import.meta.dirname, "..");

function readSource(relativePath) {
  return readFileSync(path.join(appRoot, relativePath), "utf8");
}

const internalSymbols = [
  ["src/lib/api/v2/client.ts", "apiUrl", "function"],
  ["src/lib/api/v2/errors.ts", "UnauthorizedError", "class"],
  ["src/lib/api/v2/idempotency.ts", "newRequestId", "function"],
  ["src/lib/api/v2/uploads.ts", "xhrS3Uploader", "const"],
  ["src/lib/api/v2/uploads.ts", "mockS3Uploader", "const"],
  ["src/lib/api/v2/uploads.ts", "defaultS3Uploader", "const"],
  ["src/lib/api/v2/uploads.ts", "createUploadIntent", "function"],
  ["src/lib/api/v2/uploads.ts", "completeUploadIntent", "function"],
  ["src/lib/auth/providers.ts", "devProvider", "const"],
  ["src/lib/auth/providers.ts", "googleProvider", "const"],
];

const moduleNamespaces = new Map(
  await Promise.all(
    [...new Set(internalSymbols.map(([relativePath]) => relativePath))].map(
      async (relativePath) => [relativePath, await import(`../${relativePath}`)],
    ),
  ),
);

test("internal execution symbols keep declarations without being exported", () => {
  const missingDeclarations = [];
  const leakedExports = [];

  for (const [relativePath, symbol, declarationKind] of internalSymbols) {
    const source = readSource(relativePath);
    const asyncPrefix = declarationKind === "function" ? "(?:async\\s+)?" : "";
    const declaration = new RegExp(
      `\\b${asyncPrefix}${declarationKind}\\s+${symbol}\\b`,
    );

    if (!declaration.test(source)) missingDeclarations.push(symbol);
    if (symbol in moduleNamespaces.get(relativePath)) leakedExports.push(symbol);
  }

  assert.deepEqual(missingDeclarations, []);
  assert.deepEqual(leakedExports, []);
});

test("RefreshRequest alias is absent from the handwritten v2 types", () => {
  const source = readSource("src/lib/api/v2/types.ts");

  assert.doesNotMatch(source, /\b(?:export\s+)?type\s+RefreshRequest\b/);
});

test("deletePracticeSession remains part of the sessions module contract", () => {
  const source = readSource("src/lib/api/v2/sessions.ts");

  assert.match(
    source,
    /\bexport\s+async\s+function\s+deletePracticeSession\b/,
  );
});
