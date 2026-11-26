package com.acttub.actingapi.feature.reading.app;

import java.util.UUID;

/**
 * 오래 걸린 발음 보고서가 다 됐을 때 불리는 포트(SOMA-1169). 긴 리딩은 채점이 몇 분 걸려 배우가 그동안 화면을 떠난다 —
 * 지금은 {@code push} 가 이것을 구현해 「발음 보고서가 나왔어요」를 보낸다.
 *
 * <p>알림은 보고서에 영향을 주면 안 된다. {@link PronunciationWorker} 가 보고서를 닫은 <b>후에</b> 부르고, 던져진 예외는 로그만 남긴다.
 */
public interface PronunciationReportListener {

    void onPronunciationReportReady(UUID userId, UUID sessionId);
}
