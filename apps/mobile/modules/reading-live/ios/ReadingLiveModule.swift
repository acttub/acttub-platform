import ActivityKit
import AVFoundation
import ExpoModulesCore

/// 리딩을 화면 밖에서 이어 가는 모듈(SOMA-802). 배경 소리·녹음은 UIBackgroundModes audio 가 맡고, 여기서는 Live Activity 를
/// 띄우고(위젯 확장은 targets/reading-live-widget) 잠금 화면 [일시정지]와 오디오 끊김(전화 등)을 JS 에 알린다.
public class ReadingLiveModule: Module {
  private var observers: [NSObjectProtocol] = []

  public func definition() -> ModuleDefinition {
    Name("ReadingLive")

    Events("onPause", "onInterrupt")

    OnCreate {
      let center = NotificationCenter.default
      // ReadingPauseIntent(LiveActivityIntent)는 앱 프로세스에서 돌아 이 알림을 보낸다.
      observers.append(center.addObserver(forName: Notification.Name("ActtubReadingPause"), object: nil, queue: .main) { [weak self] _ in
        self?.sendEvent("onPause")
      })
      observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
        guard
          let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          AVAudioSession.InterruptionType(rawValue: raw) == .began
        else { return }
        self?.sendEvent("onInterrupt")
      })
    }

    OnDestroy {
      observers.forEach { NotificationCenter.default.removeObserver($0) }
      observers.removeAll()
    }

    Function("start") { (state: LiveStateRecord, _: String) in
      let content = state.content
      Task { await Self.restart(content) }
    }

    Function("update") { (state: LiveStateRecord) in
      let content = ActivityContent(state: state.content, staleDate: nil)
      Task {
        for activity in Activity<ReadingActivityAttributes>.activities {
          await activity.update(content)
        }
      }
    }

    Function("stop") {
      Task { await Self.endAll() }
    }

    // 배경 소리·녹음은 UIBackgroundModes audio 가 맡는다.
    Function("keepsRunning") { true }
  }

  private static func endAll() async {
    for activity in Activity<ReadingActivityAttributes>.activities {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }

  /// 지난 실행이 남긴 카드(앱이 꺼졌던 경우)를 닫고 새로 띄운다. 사용자가 Live Activity 를 껐으면 띄우지 않는다.
  private static func restart(_ content: ReadingActivityAttributes.ContentState) async {
    await endAll()
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    _ = try? Activity.request(
      attributes: ReadingActivityAttributes(),
      content: ActivityContent(state: content, staleDate: nil),
      pushType: nil
    )
  }
}

struct LiveStateRecord: Record {
  @Field var scene: String = ""
  @Field var progress: String = ""
  @Field var fraction: Double = 0
  @Field var initial: String = ""
  @Field var status: String = ""
  @Field var headline: String = ""
  @Field var chipLabel: String = ""
  @Field var mine: Bool = false
  @Field var paused: Bool = false
  @Field var prevRole: String? = nil
  @Field var prevText: String? = nil
  @Field var text: String = ""

  var content: ReadingActivityAttributes.ContentState {
    .init(
      scene: scene, progress: progress, fraction: fraction, initial: initial, status: status, headline: headline,
      chipLabel: chipLabel, mine: mine, paused: paused, prevRole: prevRole, prevText: prevText, text: text
    )
  }
}
