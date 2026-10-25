Pod::Spec.new do |s|
  s.name           = 'KakaoShare'
  s.version        = '1.0.0'
  s.summary        = 'Acttub: KakaoTalk sharing (feed template)'
  s.description    = 'Acttub: KakaoTalk sharing (feed template)'
  s.license        = 'UNLICENSED'
  s.author         = 'Acttub'
  s.homepage       = 'https://acttub.com'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # 카카오 로그인(@react-native-seoul/kakao-login)이 고정한 판과 같아야 pod install 이 충돌하지 않는다.
  # 2.22.7 이 CocoaPods 에 올라온 마지막 판이다.
  s.dependency 'KakaoSDKShare', '2.22.7'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.swift"
end
