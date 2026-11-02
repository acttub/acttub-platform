package com.acttub.readinglive

import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * 리딩 동안 앞에 띄워 두는 서비스(재생·마이크). 알림은 ReadingLiveNotification 이 만든다. 앱을 최근 목록에서 지우면 함께 멈춘다.
 */
class ReadingLiveService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_PAUSE) {
      onPause?.invoke()
      return START_NOT_STICKY
    }
    val current = state
    if (current == null) {
      stopSelf()
      return START_NOT_STICKY
    }
    micInBackground = startForegroundFor(ReadingLiveNotification.build(this, current, channelName))
    running = true
    return START_NOT_STICKY
  }

  /**
   * 재생 종류로만 띄운다(앱 1.1.1). 배경에서 마이크를 열지 않으므로 안드로이드 10 이상은 늘 false — 말하기 회차는 배경으로 가면
   * 멈추고, 마이크를 안 쓰는 전체 듣기·자동 넘김은 JS 가 그대로 이어 간다. 안드로이드 10 미만은 배경 마이크 제한이 없어 true.
   */
  private fun startForegroundFor(notification: android.app.Notification): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification)
      return true
    }
    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    return false
  }

  override fun onDestroy() {
    running = false
    micInBackground = false
    super.onDestroy()
  }

  companion object {
    const val ACTION_PAUSE = "com.acttub.readinglive.PAUSE"
    private const val NOTIFICATION_ID = 8020

    @Volatile private var state: LiveState? = null
    @Volatile private var channelName: String = ""
    @Volatile private var running = false
    @Volatile var micInBackground = false
      private set
    @Volatile var onPause: (() -> Unit)? = null

    fun start(context: Context, next: LiveState, name: String) {
      state = next
      channelName = name
      val intent = Intent(context, ReadingLiveService::class.java)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
      } catch (_: Exception) {
        // 앱이 배경일 때 부르면 거절된다 — 리딩은 화면에서만 돈다.
        micInBackground = false
      }
    }

    fun update(context: Context, next: LiveState) {
      state = next
      if (!running) return
      context.getSystemService(NotificationManager::class.java)
        ?.notify(NOTIFICATION_ID, ReadingLiveNotification.build(context, next, channelName))
    }

    fun stop(context: Context) {
      state = null
      context.stopService(Intent(context, ReadingLiveService::class.java))
    }
  }
}
