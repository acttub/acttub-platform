/**
 * onnxruntime-web 의 wasm 런타임을 public/ort 로 복사한다.
 *
 * 40MB 가 넘어 저장소에 넣지 않는다. 대신 dev·build 직전에 node_modules 에서 가져온다.
 * 버전이 올라가도 설치된 것을 그대로 복사하므로 손댈 일이 없다.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const FILES = [
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
];

const from = path.resolve("node_modules/onnxruntime-web/dist");
const to = path.resolve("public/ort");

if (!existsSync(from)) {
  console.error("onnxruntime-web 이 설치되어 있지 않다. pnpm install 을 먼저 돌려라.");
  process.exit(1);
}

await mkdir(to, { recursive: true });
for (const f of FILES) {
  await copyFile(path.join(from, f), path.join(to, f));
}
console.log(`ort 런타임 ${FILES.length}개를 public/ort 로 복사했다.`);
