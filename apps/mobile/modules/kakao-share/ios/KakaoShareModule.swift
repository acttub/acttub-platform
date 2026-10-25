import ExpoModulesCore
import KakaoSDKCommon
import KakaoSDKShare
import UIKit

/// 카카오톡 공유 피드 카드에 들어갈 값. 만드는 규칙은 JS(lib/challenge/share.ts kakaoFeed)가 정한다.
struct FeedOptions: Record {
  @Field var title: String = ""
  @Field var description: String = ""
  @Field var imageUrl: String = ""
  @Field var linkUrl: String = ""
  @Field var buttonTitle: String = ""
}

/// 카카오톡 공유(SOMA-819). 기본 피드 템플릿(그림·제목·설명 + 버튼 하나)을 카카오톡으로 보낸다.
/// 앱 키는 카카오 로그인 플러그인이 Info.plist 에 넣은 KAKAO_APP_KEY 를 같이 쓴다.
/// 키가 없거나 카카오톡이 없으면 "unavailable" 을 돌려주고, JS 가 기기 공유 창으로 대신 보낸다.
public class KakaoShareModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KakaoShare")

    AsyncFunction("shareFeed") { (options: FeedOptions, promise: Promise) in
      guard let appKey = Bundle.main.object(forInfoDictionaryKey: "KAKAO_APP_KEY") as? String,
            !appKey.isEmpty else {
        promise.resolve("unavailable")
        return
      }
      KakaoSDK.initSDK(appKey: appKey)
      guard ShareApi.isKakaoTalkSharingAvailable() else {
        promise.resolve("unavailable")
        return
      }
      let link: [String: Any] = ["web_url": options.linkUrl, "mobile_web_url": options.linkUrl]
      let template: [String: Any] = [
        "object_type": "feed",
        "content": [
          "title": options.title,
          "description": options.description,
          "image_url": options.imageUrl,
          "link": link,
        ],
        "buttons": [["title": options.buttonTitle, "link": link]],
      ]
      ShareApi.shared.shareDefault(templateObject: template) { result, error in
        guard let result = result else {
          promise.reject("KAKAO_SHARE_FAILED", error?.localizedDescription ?? "no sharing result")
          return
        }
        UIApplication.shared.open(result.url, options: [:]) { _ in
          promise.resolve("talk")
        }
      }
    }.runOnQueue(.main)
  }
}
