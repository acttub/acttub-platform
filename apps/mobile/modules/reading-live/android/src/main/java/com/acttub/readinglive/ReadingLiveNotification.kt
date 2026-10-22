package com.acttub.readinglive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build

/** 리딩 진행 알림. */
object ReadingLiveNotification {
  private const val CHANNEL_ID = "reading_live"

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
      .setContentTitle(state.status)
      .setContentText(state.text)
      .setSubText("${state.scene} · ${state.shortProgress}")
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
    openAppIntent(context)?.let(builder::setContentIntent)
    return builder.build()
  }

  private fun ensureChannel(context: Context, name: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    // 소리·진동 없이 조용히 보인다. IMPORTANCE_MIN 은 Live Update 로 올라가지 못해 쓰지 않는다.
    manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, name, NotificationManager.IMPORTANCE_LOW))
  }

  private fun openAppIntent(context: Context): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    return PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }
}
