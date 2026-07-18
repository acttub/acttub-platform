import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

import ts from "typescript";

function isExtensionlessRelativeSpecifier(specifier) {
  return (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !/\.[cm]?[jt]sx?(?:[?#]|$)/i.test(specifier)
  );
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (isExtensionlessRelativeSpecifier(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
  load(url, context, nextLoad) {
    if (!url.endsWith(".ts")) return nextLoad(url, context);

    const filename = fileURLToPath(url);
    const source = readFileSync(filename, "utf8");
    const transpiled = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    });
    return {
      format: "module",
      shortCircuit: true,
      source: transpiled.outputText,
    };
  },
});
