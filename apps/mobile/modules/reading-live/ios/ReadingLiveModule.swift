import AVFoundation
import ExpoModulesCore

/// 리딩을 화면 밖에서 이어 가는 모듈(SOMA-802). 배경 소리·녹음은 UIBackgroundModes audio 가 맡고, 여기서는 오디오 끊김을 알린다.
public class ReadingLiveModule: Module {
  private var observers: [NSObjectProtocol] = []

  public func definition() -> ModuleDefinition {
    Name("ReadingLive")

    Events("onPause", "onInterrupt")

    OnCreate {
      observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
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

    Function("start") { (_: [String: Any], _: String) in }

    Function("update") { (_: [String: Any]) in }

    Function("stop") {}

    Function("keepsRunning") { true }
  }
}
