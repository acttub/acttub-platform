import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

// tsconfig 의 paths 와 같은 자리를 가리킨다: "@/x" → "<apps/web>/src/x".
const srcRoot = path.resolve(import.meta.dirname, "../src");

function hasKnownExtension(specifier) {
  return /\.[cm]?[jt]sx?(?:[?#]|$)/i.test(specifier);
}

function isExtensionlessRelativeSpecifier(specifier) {
  return (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !hasKnownExtension(specifier)
  );
}

const NEXT_FONT_STUB = `data:text/javascript,${encodeURIComponent(
  'const font = () => ({ className: "", variable: "", style: { fontFamily: "serif" } }); export const Noto_Serif_KR = font;',
)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    // next/font 는 빌드 때 컴파일러가 바꿔 넣는 자리라 Node 에는 실체가 없다. 빈 글꼴 대역을 준다.
    if (specifier === "next/font/google") {
      return { shortCircuit: true, url: NEXT_FONT_STUB };
    }
    // "@/" 는 번들러만 아는 별칭이라 Node 에게는 파일 URL 로 바꿔 준다.
    const aliased = specifier.startsWith("@/");
    const target = aliased
      ? pathToFileURL(path.join(srcRoot, specifier.slice(2))).href
      : specifier;
    try {
      return nextResolve(target, context);
    } catch (error) {
      const canProbe = aliased
        ? !hasKnownExtension(target)
        : isExtensionlessRelativeSpecifier(target);
      if (!canProbe) throw error;
      for (const extension of [".ts", ".tsx"]) {
        try {
          return nextResolve(`${target}${extension}`, context);
        } catch {
          // 다음 확장자로 넘어간다. 전부 실패하면 아래에서 원래 오류를 던진다.
        }
      }
      throw error;
    }
  },
  load(url, context, nextLoad) {
    if (!/\.tsx?$/.test(url)) return nextLoad(url, context);

    const filename = fileURLToPath(url);
    const source = readFileSync(filename, "utf8");
    // 커버리지는 실행한 코드의 글자 위치를 디스크의 원문 줄에 겹쳐 센다. 타입을 같은 길이의 공백으로
    // 지우는 strip 모드는 위치가 그대로라 줄이 맞는다. JSX 와 strip 모드가 못 다루는 문법(enum 등)만
    // 변환하고, 그때는 소스맵을 붙여 test:coverage 의 --enable-source-maps 가 원문 줄로 되돌린다.
    if (url.endsWith(".ts")) {
      try {
        return {
          format: "module",
          shortCircuit: true,
          source: stripTypeScriptTypes(source, { mode: "strip" }),
        };
      } catch {
        // 아래 변환으로 넘어간다.
      }
    }
    const transpiled = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        // tsconfig 와 같은 자동 런타임. 이 옵션이 있어도 JSX 가 없는 .ts 의
        // 출력은 바이트 단위로 같아서 기존 스위트에 영향이 없다.
        jsx: ts.JsxEmit.ReactJSX,
        inlineSourceMap: true,
        inlineSources: true,
      },
    });
    return {
      format: "module",
      shortCircuit: true,
      source: transpiled.outputText,
    };
  },
});
