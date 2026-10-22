Pod::Spec.new do |s|
  s.name           = 'ReadingLive'
  s.version        = '1.0.0'
  s.summary        = 'Acttub reading: background session, Live Activity'
  s.description    = 'Acttub reading: background session, Live Activity'
  s.license        = 'UNLICENSED'
  s.author         = 'Acttub'
  s.homepage       = 'https://acttub.com'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.swift"
end
