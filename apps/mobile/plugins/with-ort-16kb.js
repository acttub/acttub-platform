// onnxruntime-react-native 1.24.3 의 libonnxruntimejsi.so 가 4KB 페이지로 링크돼
// 16KB 페이지 기기(Android 15+, 예: Galaxy S24/One UI 7)에서 dlopen 시 SIGSEGV → 앱 런치 즉시 크래시.
// 이 JSI 라이브러리는 앱 빌드 때 이 패키지의 CMake(externalNativeBuild)로 소스에서 컴파일되므로,
// NDK r27 의 -DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON (→ -Wl,-z,max-page-size=16384) 를 주입하면
// 16KB 정렬로 다시 빌드돼 고쳐진다. core libonnxruntime.so(prefab prebuilt)는 이미 16KB 라 무관.
//
// EAS clean 빌드에서도 살아남게 prebuild(dangerousMod) 시점에 node_modules 의 build.gradle 을 패치한다.
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const FLAG = '"-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON"';

module.exports = function withOrt16kb(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const gradlePath = path.join(
        cfg.modRequest.projectRoot,
        'node_modules',
        'onnxruntime-react-native',
        'android',
        'build.gradle',
      );
      if (!fs.existsSync(gradlePath)) {
        console.warn('[with-ort-16kb] build.gradle 을 찾지 못함, 건너뜀:', gradlePath);
        return cfg;
      }
      let contents = fs.readFileSync(gradlePath, 'utf8');
      if (contents.includes('ANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES')) {
        return cfg; // 이미 패치됨(idempotent)
      }
      // cmake arguments 리스트의 마지막 인자("-DUSE_NNAPI=...") 뒤에 16KB 플래그를 덧붙인다.
      // build.gradle 에 두 번(RN>=71 분기 / else) 등장하므로 전부 치환.
      const anchor = '"-DUSE_NNAPI=${!useQnn}"';
      if (!contents.includes(anchor)) {
        console.warn('[with-ort-16kb] cmake arguments 앵커를 찾지 못함, 건너뜀');
        return cfg;
      }
      contents = contents.split(anchor).join(`${anchor},\n            ${FLAG}`);
      fs.writeFileSync(gradlePath, contents);
      console.log('[with-ort-16kb] libonnxruntimejsi.so 16KB 정렬 플래그 주입 완료');
      return cfg;
    },
  ]);
};
