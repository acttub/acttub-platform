package com.acttub.readinglive

import android.content.Context
import android.media.AudioManager
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 리딩을 화면 밖에서 이어 가는 모듈(SOMA-802). 재생 포그라운드 서비스를 띄워 배경에서도 소리가 돌게 하고(안드로이드는 마이크 없이),
 * 통화가 시작되면 끊김을 알린다.
 */
class ReadingLiveModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext)
  // 안드로이드 12 미만에는 없는 타입이라 Any 로 든다.
  private var modeListener: Any? = null
  /** 배경에서도 JS 타이머가 돌게 잡아 둔 헤드리스 작업. */
  private var keepAliveTask: Int? = null

  override fun definition() = ModuleDefinition {
    Name("ReadingLive")

    Events("onPause", "onInterrupt")

    OnCreate {
      ReadingLiveService.onPause = { sendEvent("onPause") }
    }

    OnDestroy {
      ReadingLiveService.onPause = null
      stopKeepAlive()
      stopListeningForCalls()
      ReadingLiveService.stop(context)
    }

    Function("start") { state: LiveState, channelName: String ->
      ReadingLiveService.start(context, state, channelName)
      listenForCalls()
      startKeepAlive()
    }

    Function("update") { state: LiveState ->
      ReadingLiveService.update(context, state)
    }

    Function("stop") {
      stopKeepAlive()
      stopListeningForCalls()
      ReadingLiveService.stop(context)
    }

    Function("keepsRunning") { ReadingLiveService.micInBackground }
  }

  /**
   * React Native 안드로이드는 앱이 배경으로 가면 JS 타이머(setTimeout)를 멈춘다. 그러면 자동 넘김의 쉬는 시간·지문 멈춤이
   * 끝나지 않아 화면을 끄는 순간 줄이 멈춘다(11/1 폰 확인). 헤드리스 JS 작업이 도는 동안은 타이머가 계속 돌므로, 리딩 서비스가
   * 떠 있는 동안 끝나지 않는 작업(ReadingKeepAlive, index.ts 에 등록) 하나를 잡아 둔다. 실패해도 리딩은 예전처럼 배경에서 멈출 뿐이다.
   */
  private fun startKeepAlive() {
    val react = appContext.reactContext as? ReactContext ?: return
    UiThreadUtil.runOnUiThread {
      if (keepAliveTask != null) return@runOnUiThread
      keepAliveTask = try {
        HeadlessJsTaskContext.getInstance(react)
          .startTask(HeadlessJsTaskConfig(KEEP_ALIVE_TASK, Arguments.createMap(), 0, true))
      } catch (_: Exception) {
        null
      }
    }
  }

  private fun stopKeepAlive() {
    val react = appContext.reactContext as? ReactContext ?: return
    UiThreadUtil.runOnUiThread {
      val task = keepAliveTask ?: return@runOnUiThread
      keepAliveTask = null
      try {
        val tasks = HeadlessJsTaskContext.getInstance(react)
        if (tasks.isTaskRunning(task)) tasks.finishTask(task)
      } catch (_: Exception) {
      }
    }
  }

  // shortcut: 통화 감지는 Android 12+ 의 오디오 모드 변화로만 한다. 11 이하는 통화가 와도 리딩이 멈추지 않는다 — 문제가 되면 오디오 포커스로 넓힌다.
  private fun listenForCalls() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || modeListener != null) return
    val audio = context.getSystemService(AudioManager::class.java) ?: return
    val listener = AudioManager.OnModeChangedListener { mode ->
      if (mode in CALL_MODES) sendEvent("onInterrupt")
    }
    audio.addOnModeChangedListener(context.mainExecutor, listener)
    modeListener = listener
  }

  private fun stopListeningForCalls() {
    val listener = modeListener ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      context.getSystemService(AudioManager::class.java)?.removeOnModeChangedListener(listener as AudioManager.OnModeChangedListener)
    }
    modeListener = null
  }

  companion object {
    const val KEEP_ALIVE_TASK = "ReadingKeepAlive"
    private val CALL_MODES = setOf(
      AudioManager.MODE_RINGTONE,
      AudioManager.MODE_IN_CALL,
      AudioManager.MODE_IN_COMMUNICATION,
      AudioManager.MODE_CALL_SCREENING,
    )
  }
}
