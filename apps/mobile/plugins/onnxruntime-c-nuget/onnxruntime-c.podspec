# onnxruntime-c 를 Microsoft NuGet 공식 패키지에서 받는다 (SOMA-1152).
#
# 원래 pod(trunk 1.30.0)는 download.onnxruntime.ai 에서 받는데, 2026-11-20쯤부터 이 주소가 잘못된 TLS 인증서와
# 404 를 돌려줘 깨끗한 pod install(EAS 포함)이 실패한다. 같은 버전의 iOS xcframework 가 NuGet 패키지
# Microsoft.ML.OnnxRuntime 1.30.0 의 runtimes/ios/native/ 에 들어 있으니 그것을 꺼내 쓴다.
# 엔진 버전·빌드 설정은 trunk podspec 1.30.0 과 같다. sha256 은 NuGet 패키지 파일의 값이다.
# download.onnxruntime.ai 가 복구되면 플러그인(with-ort-nuget-pod.js)을 빼서 원래대로 돌릴 수 있다.
Pod::Spec.new do |s|
  s.name = 'onnxruntime-c'
  s.version = '1.30.0'
  s.summary = 'ONNX Runtime C/C++ Pod'
  s.description = 'A pod for the ONNX Runtime C/C++ library.'
  s.homepage = 'https://github.com/microsoft/onnxruntime'
  s.license = { :type => 'MIT', :file => 'LICENSE' }
  s.authors = { 'ONNX Runtime' => 'onnxruntime@microsoft.com' }
  s.source = {
    :http => 'https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime/1.30.0/microsoft.ml.onnxruntime.1.30.0.nupkg',
    :type => 'zip',
    :sha256 => '30df119bd9164eaa187666d93147448fdd4a9a1a3caf83f1505daf7af2d1c5d2',
  }
  s.prepare_command = <<-CMD
    set -e
    unzip -q -o runtimes/ios/native/onnxruntime.xcframework.zip
    mkdir -p Headers
    cp onnxruntime.xcframework/ios-arm64/onnxruntime.framework/Headers/*.h Headers/
    rm -rf runtimes build buildTransitive lib analyzers
  CMD
  s.platforms = { :ios => '15.1' }
  s.vendored_frameworks = 'onnxruntime.xcframework'
  s.static_framework = true
  s.weak_frameworks = 'CoreML'
  s.ios.frameworks = 'CoreFoundation', 'Foundation', 'Network', 'Security', 'SystemConfiguration', 'UIKit'
  s.source_files = 'Headers/*.h'
  s.preserve_paths = 'LICENSE'
  s.libraries = 'c++'
  s.pod_target_xcconfig = { 'OTHER_CPLUSPLUSFLAGS' => '-fvisibility=hidden -fvisibility-inlines-hidden' }
end
