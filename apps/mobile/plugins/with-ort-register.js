// Expo autolinking 이 onnxruntime-react-native 의 gradle 프로젝트(.so)만 빌드하고
// OnnxruntimePackage(ReactPackage)를 React 패키지 리스트에 등록하지 않는다 →
// 런타임에 NativeModules.Onnxruntime = null → "install of null" 크래시.
// (구 아키텍처 최소앱에서 이 수동 등록이 근본 해결이었다. SOMA-500.)
// MainApplication.getPackages() 의 PackageList(this).packages.apply{} 에 수동 add.
const { withMainApplication } = require('@expo/config-plugins');

const PKG = 'add(ai.onnxruntime.reactnative.OnnxruntimePackage())';

module.exports = function withOrtRegister(config) {
  return withMainApplication(config, (config) => {
    let src = config.modResults.contents;
    if (src.includes('OnnxruntimePackage')) return config; // 이미 등록됨

    // Kotlin: PackageList(this).packages.apply {  ...  }
    const anchor = 'PackageList(this).packages.apply {';
    if (src.includes(anchor)) {
      src = src.replace(anchor, `${anchor}\n              ${PKG}`);
    } else {
      // 폴백: getPackages() 가 다른 형태면 packages 반환 직전에 못 넣으니 경고만.
      console.warn('[with-ort-register] PackageList.apply 앵커를 못 찾음 — 수동 등록 실패 가능');
      return config;
    }
    config.modResults.contents = src;
    console.log('[with-ort-register] OnnxruntimePackage 수동 등록 주입 완료');
    return config;
  });
};
