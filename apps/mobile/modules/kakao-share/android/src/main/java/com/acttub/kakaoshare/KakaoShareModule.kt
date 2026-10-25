package com.acttub.kakaoshare

import android.content.Context
import android.content.Intent
import com.kakao.sdk.common.KakaoSdk
import com.kakao.sdk.share.ShareClient
import com.kakao.sdk.template.model.Button
import com.kakao.sdk.template.model.Content
import com.kakao.sdk.template.model.FeedTemplate
import com.kakao.sdk.template.model.Link
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** 카카오톡 공유 피드 카드에 들어갈 값. 만드는 규칙은 JS(lib/challenge/share.ts kakaoFeed)가 정한다. */
class FeedOptions : Record {
  @Field val title: String = ""
  @Field val description: String = ""
  @Field val imageUrl: String = ""
  @Field val linkUrl: String = ""
  @Field val buttonTitle: String = ""
}

/**
 * 카카오톡 공유(SOMA-819). 기본 피드 템플릿(그림·제목·설명 + 버튼 하나)을 카카오톡으로 보낸다.
 * 앱 키는 카카오 로그인 플러그인이 넣은 문자열 리소스 kakao_app_key 를 같이 쓴다.
 * 키가 없거나 카카오톡이 없으면 "unavailable" 을 돌려주고, JS 가 기기 공유 창으로 대신 보낸다.
 */
class KakaoShareModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KakaoShare")

    AsyncFunction("shareFeed") { options: FeedOptions, promise: Promise ->
      val context = appContext.reactContext
      if (context == null || !initSdk(context) || !ShareClient.instance.isKakaoTalkSharingAvailable(context)) {
        promise.resolve("unavailable")
      } else {
        val link = Link(webUrl = options.linkUrl, mobileWebUrl = options.linkUrl)
        val template = FeedTemplate(
          content = Content(
            title = options.title,
            imageUrl = options.imageUrl,
            description = options.description,
            link = link,
          ),
          buttons = listOf(Button(options.buttonTitle, link)),
        )
        ShareClient.instance.shareDefault(context, template) { result, error ->
          if (result == null) {
            promise.reject(CodedException("KAKAO_SHARE_FAILED", error?.message ?: "no sharing result", error))
          } else {
            val activity = appContext.currentActivity
            if (activity != null) {
              activity.startActivity(result.intent)
            } else {
              context.startActivity(result.intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            promise.resolve("talk")
          }
        }
      }
    }
  }

  private fun initSdk(context: Context): Boolean {
    val id = context.resources.getIdentifier("kakao_app_key", "string", context.packageName)
    if (id == 0) return false
    val appKey = context.getString(id)
    if (appKey.isBlank()) return false
    KakaoSdk.init(context, appKey)
    return true
  }
}
