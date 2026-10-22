package com.acttub.readinglive

import android.content.Context
import android.media.AudioManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 리딩을 화면 밖에서 이어 가는 모듈(SOMA-802). 재생·마이크 포그라운드 서비스를 띄워 배경에서도 소리·녹음이 돌게 하고,
 * 통화가 시작되면 끊김을 알린다.
 */
class ReadingLiveModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext)
  // 안드로이드 12 미만에는 없는 타입이라 Any 로 든다.
  private var modeListener: Any? = null

  override fun definition() = ModuleDefinition {
    Name("ReadingLive")

    Events("onPause", "onInterrupt")

    OnCreate {
      ReadingLiveService.onPause = { sendEvent("onPause") }
    }

    OnDestroy {
      ReadingLiveService.onPause = null
      stopListeningForCalls()
      ReadingLiveService.stop(context)
    }

    Function("start") { state: LiveState, channelName: String ->
      ReadingLiveService.start(context, state, channelName)
      listenForCalls()
    }

    Function("update") { state: LiveState ->
      ReadingLiveService.update(context, state)
    }

    Function("stop") {
      stopListeningForCalls()
      ReadingLiveService.stop(context)
    }

    Function("keepsRunning") { ReadingLiveService.micInBackground }
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
    private val CALL_MODES = setOf(
      AudioManager.MODE_RINGTONE,
      AudioManager.MODE_IN_CALL,
      AudioManager.MODE_IN_COMMUNICATION,
      AudioManager.MODE_CALL_SCREENING,
    )
  }
}
