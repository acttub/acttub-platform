import AppIntents
import Foundation

/// 잠금 화면·다이내믹 아일랜드의 [일시정지](SOMA-802). LiveActivityIntent 는 앱 프로세스에서 돌아 리딩 모듈이 알림을 받는다.
/// 앱과 위젯 둘 다에 있어야 해서 _shared 에 둔다.
@available(iOS 17.0, *)
struct ReadingPauseIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Pause reading"
  static var isDiscoverable: Bool = false

  func perform() async throws -> some IntentResult {
    NotificationCenter.default.post(name: Notification.Name("ActtubReadingPause"), object: nil)
    return .result()
  }
}
