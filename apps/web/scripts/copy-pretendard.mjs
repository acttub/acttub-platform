/**
 * Pretendard 가변 동적 서브셋을 public/fonts/pretendard 로 복사한다.
 *
 * 버전 경로로 복사하므로 긴 immutable 캐시를 걸어도 다음 버전과 충돌하지 않는다.
 * 원본의 swap은 느린 첫 방문에서 LCP를 다시 잡으므로 optional로 바꾼다.
 */
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const packageRoot = path.resolve("node_modules/pretendard");
const from = path.join(packageRoot, "dist/web/variable");
const publicRoot = path.resolve("public/fonts/pretendard");
const sourceCss = path.join(from, "pretendardvariable-dynamic-subset.css");

if (!existsSync(sourceCss)) {
  console.error("pretendard 가 설치되어 있지 않다. pnpm install 을 먼저 돌려라.");
  process.exit(1);
}

const css = await readFile(sourceCss, "utf8");
const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
const to = path.join(publicRoot, packageJson.version);
const swapDeclarations = css.match(/font-display:\s*swap;/g) ?? [];

if (swapDeclarations.length !== 92) {
  console.error(`Pretendard 동적 서브셋 수가 달라졌다: ${swapDeclarations.length}개`);
  process.exit(1);
}

await rm(publicRoot, { recursive: true, force: true });
await mkdir(to, { recursive: true });
await writeFile(
  path.join(to, "pretendard.css"),
  css.replaceAll(/font-display:\s*swap;/g, "font-display: optional;"),
);
await cp(path.join(from, "woff2-dynamic-subset"), path.join(to, "woff2-dynamic-subset"), {
  recursive: true,
});

console.log(
  `Pretendard ${packageJson.version} 동적 서브셋 ${swapDeclarations.length}개를 public/fonts 로 복사했다.`,
);
