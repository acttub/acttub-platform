import ActivityKit
import Foundation

/// 리딩 Live Activity 의 상태(SOMA-802). 글은 앱(lib/reading/live.ts)이 모두 만든다.
/// modules/reading-live/ios 와 targets/reading-live-widget 에 같은 내용으로 둔다 — ActivityKit 은 타입 이름으로 둘을 잇는다.
struct ReadingActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var scene: String
    var progress: String
    var fraction: Double
    var initial: String
    var status: String
    var headline: String
    var chipLabel: String
    var mine: Bool
    var paused: Bool
    var prevRole: String?
    var prevText: String?
    var text: String
  }
}
