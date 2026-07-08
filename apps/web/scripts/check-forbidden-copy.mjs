import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../src/", import.meta.url).pathname;
const forbidden = [
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
const extensions = new Set([".ts", ".tsx"]);
const failures = [];

function extensionOf(path) {
  const index = path.lastIndexOf(".");
  return index === -1 ? "" : path.slice(index);
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      walk(path);
      continue;
    }

    if (!extensions.has(extensionOf(path))) continue;

    const source = readFileSync(path, "utf8");
    for (const term of forbidden) {
      if (source.toLowerCase().includes(term.toLowerCase())) {
        failures.push(`${path}: contains forbidden user-facing framing term "${term}"`);
      }
    }
  }
}

walk(root);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Forbidden-copy guard passed.");
