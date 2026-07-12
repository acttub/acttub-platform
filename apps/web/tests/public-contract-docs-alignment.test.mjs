import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("public errors allow safe boolean and arbitrary detail values", () => {
  const openapi = JSON.parse(read("apps/web/src/lib/api/openapi.json"));
  const details = openapi.components.schemas.ApiError.properties.error.properties.details;
  assert.equal(details.type, "object");
  assert.equal(details.additionalProperties, true);
  assert.match(details.description, /boolean/);
});

test("runtime docs keep acting credentials server-only and Gemini legacy-only", () => {
  for (const file of ["README.md", "docs/SPRING_BOOT_MIGRATION.md", "docs/SUPABASE_SCHEMA.md"]) {
    const source = read(file);
    assert.match(source, /ACTING_API_BASE_URL/);
    assert.match(source, /ACTING_API_KEY/);
    assert.match(source, /server-only|서버 전용/);
    assert.match(source, /(?:Gemini[\s\S]{0,160}(?:legacy|레거시)|(?:legacy|레거시)[\s\S]{0,160}Gemini)/i);
  }
});

test("upload docs distinguish current 550 MiB from the Slice 1 baseline", () => {
  for (const file of ["README.md", "docs/SPRING_BOOT_MIGRATION.md", "docs/SUPABASE_SCHEMA.md"]) {
    const source = read(file);
    assert.match(source, /576716800/);
    assert.match(source, /550 MiB/);
    assert.match(source, /314572800/);
    assert.match(source, /300 MiB/);
    assert.match(source, /(?:historical|역사적)/i);
  }
});
