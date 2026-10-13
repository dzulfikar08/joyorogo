Pod::Spec.new do |s|
  s.name           = 'AppleHealth'
  s.version        = '1.0.0'
  s.summary        = 'Read-only HealthKit import for the activity sync'
  s.description    = 'Local Expo module reading workouts, steps, distance, active energy and sleep from HealthKit for JoyoRogo.'
  s.license        = 'AGPL-3.0-only'
  s.homepage       = 'https://joyorogo.com'
  s.authors        = 'JoyoDigitama'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'HealthKit'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.swift'
end
