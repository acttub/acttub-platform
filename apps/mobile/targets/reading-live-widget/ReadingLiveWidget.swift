import ActivityKit
import SwiftUI
import WidgetKit

/// 리딩 Live Activity(SOMA-802). 모양은 pen 「acttub 앱」 R9.27(① 잠금 화면 ② 아일랜드 접힘 ③ 펼침, 라이트·다크).
/// 다음 차례와 진행 막대는 없고, 버튼은 [일시정지] 하나(iOS 17+). 누르면 앱이 열린다.
@main
struct ReadingLiveBundle: WidgetBundle {
  var body: some Widget {
    ReadingLiveActivity()
  }
}

private enum Palette {
  static let blue = Color(red: 0x31 / 255, green: 0x82 / 255, blue: 0xF6 / 255)
  static let islandDim = Color(red: 0x8B / 255, green: 0x95 / 255, blue: 0xA1 / 255)
  static let islandBody = Color(red: 0xE5 / 255, green: 0xE8 / 255, blue: 0xEB / 255)
  static let partner = Color(red: 0x6B / 255, green: 0x76 / 255, blue: 0x84 / 255)

  static func dim(_ scheme: ColorScheme) -> Color {
    scheme == .dark ? islandDim : Color(red: 0x6B / 255, green: 0x76 / 255, blue: 0x84 / 255)
  }
  static func strong(_ scheme: ColorScheme) -> Color {
    scheme == .dark ? .white : Color(red: 0x19 / 255, green: 0x1F / 255, blue: 0x28 / 255)
  }
  static func turn(_ scheme: ColorScheme) -> Color {
    scheme == .dark ? Color(red: 0x6A / 255, green: 0xA8 / 255, blue: 0xFF / 255) : Color(red: 0x1B / 255, green: 0x64 / 255, blue: 0xDA / 255)
  }
}

struct ReadingLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: ReadingActivityAttributes.self) { context in
      LockScreenView(state: context.state)
    } dynamicIsland: { context in
      let state = context.state
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          ProgressRing(state: state, size: 44, lineWidth: 4, fontSize: 17)
            .padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(alignment: .leading, spacing: 2) {
            Text(state.headline).font(.system(size: 17, weight: .bold)).foregroundColor(.white).lineLimit(1)
            Text("\(state.scene) · \(state.progress) · \(state.chipLabel)")
              .font(.system(size: 12)).foregroundColor(Palette.islandDim).lineLimit(1)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        DynamicIslandExpandedRegion(.trailing) {
          PauseButton(state: state, size: 44, iconSize: 18, fill: Color.white.opacity(0.15), tint: .white)
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text(state.text)
            .font(.system(size: 16)).foregroundColor(Palette.islandBody).lineLimit(2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
        }
      } compactLeading: {
        Badge(state: state, size: 22, fontSize: 11)
      } compactTrailing: {
        ProgressRing(state: state, size: 22, lineWidth: 3, fontSize: nil)
      } minimal: {
        ProgressRing(state: state, size: 22, lineWidth: 3, fontSize: 10)
      }
    }
  }
}

private struct LockScreenView: View {
  let state: ReadingActivityAttributes.ContentState
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        Text(state.scene).font(.system(size: 13)).foregroundColor(Palette.dim(scheme)).lineLimit(1)
        Spacer(minLength: 4)
        Text(state.progress).font(.system(size: 13, weight: .semibold)).foregroundColor(Palette.dim(scheme))
        PauseButton(
          state: state, size: 28, iconSize: 12,
          fill: scheme == .dark ? Color.white.opacity(0.15) : Palette.strong(scheme).opacity(0.08),
          tint: Palette.strong(scheme)
        )
      }
      if let role = state.prevRole, let text = state.prevText {
        VStack(alignment: .leading, spacing: 2) {
          Text(role).font(.system(size: 12, weight: .semibold))
          Text(text).font(.system(size: 14)).lineLimit(1)
        }
        .foregroundColor(Palette.dim(scheme))
        .padding(.horizontal, 12)
      }
      VStack(alignment: .leading, spacing: 4) {
        Text(state.status).font(.system(size: 12, weight: .semibold)).foregroundColor(Palette.turn(scheme)).lineLimit(1)
        Text(state.text).font(.system(size: 16, weight: .bold)).foregroundColor(Palette.strong(scheme)).lineLimit(2)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(12)
      .background(RoundedRectangle(cornerRadius: 12).fill(Palette.blue.opacity(scheme == .dark ? 0.2 : 0.12)))
    }
    .padding(16)
  }
}

/// 배역 첫 글자 동그라미 — 내 차례는 파랑, 상대 차례는 회색.
private struct Badge: View {
  let state: ReadingActivityAttributes.ContentState
  let size: CGFloat
  let fontSize: CGFloat

  var body: some View {
    Text(state.initial)
      .font(.system(size: fontSize, weight: .bold)).foregroundColor(.white)
      .frame(width: size, height: size)
      .background(Circle().fill(state.mine ? Palette.blue : Palette.partner))
  }
}

/// 원형 진행 — fontSize 가 있으면 가운데에 배역 첫 글자.
private struct ProgressRing: View {
  let state: ReadingActivityAttributes.ContentState
  let size: CGFloat
  let lineWidth: CGFloat
  let fontSize: CGFloat?

  var body: some View {
    ZStack {
      Circle().stroke(Color.white.opacity(0.2), lineWidth: lineWidth)
      Circle()
        .trim(from: 0, to: max(0, min(1, state.fraction)))
        .stroke(state.mine ? Palette.blue : Palette.partner, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
        .rotationEffect(.degrees(-90))
      if let fontSize {
        Text(state.initial).font(.system(size: fontSize, weight: .bold)).foregroundColor(.white)
      }
    }
    .frame(width: size, height: size)
  }
}

/// [일시정지]. 버튼이 Live Activity 안에서 동작하는 것은 iOS 17 부터라 그 아래에서는 보이지 않는다. 멈춘 동안에도 감춘다.
private struct PauseButton: View {
  let state: ReadingActivityAttributes.ContentState
  let size: CGFloat
  let iconSize: CGFloat
  let fill: Color
  let tint: Color

  var body: some View {
    if #available(iOS 17.0, *) {
      if !state.paused {
        Button(intent: ReadingPauseIntent()) {
          Image(systemName: "pause.fill")
            .font(.system(size: iconSize, weight: .bold)).foregroundColor(tint)
            .frame(width: size, height: size)
            .background(Circle().fill(fill))
        }
        .buttonStyle(.plain)
      }
    }
  }
}
