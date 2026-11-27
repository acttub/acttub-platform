import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // 벤더 산출물 — 우리 코드가 아니다. public/ort 는 scripts/copy-ort.mjs 가 onnxruntime-web 에서 복사한다.
  // 웹 리딩을 없애 이제 쓰는 곳은 없다. 의존성과 복사 스크립트를 지울 때 함께 지운다.
  globalIgnores(["public/ort/**"]),
]);

export default eslintConfig;
