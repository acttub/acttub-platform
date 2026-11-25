// iOS: onnxruntime-c pod 를 download.onnxruntime.ai 대신 Microsoft NuGet 공식 패키지에서 받게 한다 (SOMA-1152).
// 2026-11-20쯤부터 download.onnxruntime.ai 가 잘못된 인증서·404 를 돌려줘 깨끗한 pod install(EAS 포함)이 실패한다.
// 자세한 이유와 되돌리는 방법은 plugins/onnxruntime-c-nuget/onnxruntime-c.podspec 맨 위에 적었다.
// EAS 는 빌드마다 ios/ 를 새로 만들므로 prebuild(dangerousMod) 시점에 Podfile 에 한 줄을 넣는다.
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const LINE = "  pod 'onnxruntime-c', :podspec => '../plugins/onnxruntime-c-nuget/onnxruntime-c.podspec'";

function addOrtNugetPod(contents) {
  if (contents.includes('onnxruntime-c-nuget')) return contents;
  if (!/^[ \t]*use_expo_modules![ \t]*$/m.test(contents)) {
    throw new Error('with-ort-nuget-pod: Podfile 에 use_expo_modules! 줄이 없어 onnxruntime-c 를 넣을 자리를 못 찾았다');
  }
  return contents.replace(/^([ \t]*use_expo_modules![ \t]*)$/m, (m) => `${m}\n${LINE}`);
}

function withOrtNugetPod(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      fs.writeFileSync(podfile, addOrtNugetPod(fs.readFileSync(podfile, 'utf8')));
      return cfg;
    },
  ]);
}

module.exports = withOrtNugetPod;
module.exports.addOrtNugetPod = addOrtNugetPod;
