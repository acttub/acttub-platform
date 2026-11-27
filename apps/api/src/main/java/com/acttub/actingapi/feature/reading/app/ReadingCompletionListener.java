package com.acttub.actingapi.feature.reading.app;

import java.util.UUID;

/**
 * 리딩 회차가 완료로 바뀐 직후 불리는 포트(SOMA-865). 지금은 {@code invite} 가 이것을 구현해 초대받은 사람의 첫 연습을 알아본다.
 * {@link ScriptSplitListener} 와 같은 형태다 — 선언은 부르는 쪽에, 구현은 듣는 쪽에 둔다.
 *
 * <p>듣는 쪽의 실패가 진행 저장을 되돌리면 안 된다. {@link SessionService} 가 저장이 커밋된 <b>뒤에</b> 부르고, 구현은 예외를
 * 밖으로 내보내지 않는다.
 */
public interface ReadingCompletionListener {

    void onReadingCompleted(UUID userId, UUID sessionId);
}
