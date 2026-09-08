// onnxruntime-react-native 1.24.3 은 New Architecture(bridgeless) 미지원이다.
// binding 에서 `NativeModules.Onnxruntime` 를 직접 읽는데, bridgeless 에서는 이 레거시
// 접근이 null 이라 `Cannot read property 'install' of null` 로 앱이 런치 즉시 죽는다.
// (모듈 자체는 PackageList 에 정상 등록됨 — 접근 경로만 문제.)
//
// bridgeless 에서 레거시 ReactPackage 모듈은 TurboModule 인터롭을 통해
// TurboModuleRegistry.get(name) 으로 접근할 수 있다. 그 폴백을 심어 New Arch 를
// 유지한 채 ORT 를 살린다. reanimated 4 가 New Arch 를 강제하므로 끌 수 없다.
//
// EAS clean 빌드에서도 살아남게 prebuild(dangerousMod) 때 node_modules 파일을 패치한다.
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

function patchFile(file) {
  if (!fs.existsSync(file)) return false;
  let c = fs.readFileSync(file, 'utf8');
  if (c.includes('TurboModuleRegistry')) return true; // 이미 패치됨

  // 1) import 에 TurboModuleRegistry 추가 (ESM 소스 / CommonJS 빌드 둘 다 대응)
  c = c.replace(
    /import\s*\{\s*NativeModules\s*\}\s*from\s*'react-native';/,
    "import { NativeModules, TurboModuleRegistry } from 'react-native';",
  );

  // 2) 모듈 해석에 TurboModuleRegistry 폴백 추가
  //    ESM:  export const Module = NativeModules.Onnxruntime;
  c = c.replace(
    /(export const Module = )NativeModules\.Onnxruntime;/,
    "$1NativeModules.Onnxruntime ?? TurboModuleRegistry.get('Onnxruntime');",
  );
  //    CJS:  const Module = exports.Module = _reactNative.NativeModules.Onnxruntime;
  c = c.replace(
    /(const Module = exports\.Module = )_reactNative\.NativeModules\.Onnxruntime;/,
    "$1_reactNative.NativeModules.Onnxruntime ?? _reactNative.TurboModuleRegistry.get('Onnxruntime');",
  );

  // 3) install() 호출을 null-guard (혹시라도 못 찾으면 명확한 에러가 프록시에서 나게)
  c = c.replace(
    /if \(typeof globalThis\.OrtApi === 'undefined'\) \{/,
    "if (Module && typeof globalThis.OrtApi === 'undefined') {",
  );

  fs.writeFileSync(file, c);
  return true;
}

module.exports = function withOrtNewArch(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const base = path.join(cfg.modRequest.projectRoot, 'node_modules', 'onnxruntime-react-native');
      const targets = [
        path.join(base, 'lib', 'binding.ts'),
        path.join(base, 'dist', 'commonjs', 'binding.js'),
        path.join(base, 'dist', 'module', 'binding.js'),
      ];
      let any = false;
      for (const t of targets) {
        if (patchFile(t)) any = true;
      }
      console.log(any ? '[with-ort-newarch] ORT binding bridgeless 폴백 주입 완료' : '[with-ort-newarch] 대상 파일 없음');
      return cfg;
    },
  ]);
};
