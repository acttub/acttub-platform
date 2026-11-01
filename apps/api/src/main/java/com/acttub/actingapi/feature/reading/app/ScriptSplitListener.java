package com.acttub.actingapi.feature.reading.app;

import java.util.UUID;

/**
 * 나누기 작업이 대본을 저장한 직후 불리는 포트(reading.script 「나누기 작업」, SOMA-960). 나누기는 1분 넘게 걸리고 배우는 그동안 화면을
 * 떠날 수 있다 — 지금은 {@code push} 가 이것을 구현해 「대본을 다 나눴어요」를 보낸다.
 *
 * <p>알림은 나누기 결과에 영향을 주면 안 된다. {@link ScriptSplitWorker} 가 저장 <b>후에</b> 부르고, 던져진 예외는 보고만 한다.
 */
public interface ScriptSplitListener {

    void onScriptSplit(UUID userId, UUID scriptId);
}
