package com.acttub.readinglive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.Icon
import android.os.Build
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan

/**
 * 리딩 진행 알림(SOMA-802). 모양은 pen 「acttub 앱」 R9.28 — 기본 알림 틀(BigTextStyle)에 머리 「Acttub · 장면 · 2/15」,
 * 제목 「태오 · 내 차례 · 듣는 중」, 본문 앞 줄(흐리게)·지금 줄(굵게), 액션 [일시정지], 상태 막대 칩 「태 2/15」.
 *
 * 안드로이드 16+ 에서 Live Update 로 올라가도록 조건을 지킨다(https://developer.android.com/develop/ui/views/notifications/live-update):
 * 승격 요청·ongoing·contentTitle, 직접 그린 뷰(RemoteViews)와 setColorized 는 쓰지 않는다. 15 이하는 일반 진행 중 알림으로 보인다.
 */
object ReadingLiveNotification {
  private const val CHANNEL_ID = "reading_live"
  private const val ACCENT = 0xFF3182F6.toInt()
  private const val DIM = 0xFF6B7684.toInt()

  // Notification.EXTRA_REQUEST_PROMOTED_ONGOING(API 36.1)의 값. 상수가 없는 compileSdk 에서도 쓰려고 글자로 둔다.
  private const val EXTRA_REQUEST_PROMOTED_ONGOING = "android.requestPromotedOngoing"

  fun build(context: Context, state: LiveState, channelName: String): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      ensureChannel(context, channelName)
      Notification.Builder(context, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context)
    }
    builder
      .setSmallIcon(R.drawable.reading_live_icon)
      .setColor(ACCENT)
      .setContentTitle(state.status)
      .setContentText(state.text)
      .setSubText("${state.scene} · ${state.shortProgress}")
      .setStyle(Notification.BigTextStyle().bigText(body(state)))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setCategory(Notification.CATEGORY_PROGRESS)
      .addExtras(android.os.Bundle().apply { putBoolean(EXTRA_REQUEST_PROMOTED_ONGOING, true) })
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA) {
      // 상태 막대 칩: 배역 첫 글자 + 진행. 칩 색은 시스템이 정한다(setColorized 금지).
      builder.setShortCriticalText("${state.initial} ${state.shortProgress}")
    }
    openAppIntent(context)?.let(builder::setContentIntent)
    if (!state.paused) {
      val pause = PendingIntent.getService(
        context,
        1,
        Intent(context, ReadingLiveService::class.java).setAction(ReadingLiveService.ACTION_PAUSE),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      builder.addAction(
        Notification.Action.Builder(Icon.createWithResource(context, R.drawable.reading_live_pause), state.pauseLabel, pause).build(),
      )
    }
    return builder.build()
  }

  /** 앞 줄(배역 + 대사, 흐리게)과 지금 줄(굵게). 승격된 알림이 글자 모양을 지우면 글만 남는다. */
  private fun body(state: LiveState): CharSequence {
    val text = SpannableStringBuilder()
    val prevRole = state.prevRole
    val prevText = state.prevText
    if (prevRole != null && prevText != null) {
      text.append("$prevRole  $prevText", ForegroundColorSpan(DIM), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      text.append('\n')
    }
    text.append(state.text, StyleSpan(Typeface.BOLD), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    return text
  }

  private fun ensureChannel(context: Context, name: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    // 소리·진동 없이 조용히 보인다. IMPORTANCE_MIN 은 Live Update 로 올라가지 못해 쓰지 않는다.
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, name, NotificationManager.IMPORTANCE_LOW).apply {
        setShowBadge(false)
        lightColor = Color.BLUE
      },
    )
  }

  private fun openAppIntent(context: Context): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    return PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }
}
