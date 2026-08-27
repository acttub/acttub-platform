import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // 상대역 리딩이 쓰는 벤더 산출물 — 우리 코드가 아니다.
  // public/ort 는 scripts/copy-ort.mjs 가 onnxruntime-web 에서 복사하고, pdf 워커는 pdfjs-dist 사본이다.
  globalIgnores(["public/ort/**", "public/pdf.worker.min.mjs", "src/lib/reading/audio/supertonic/helper.js"]),
]);

export default eslintConfig;
