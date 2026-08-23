package com.acttub.actingapi.feature.analysis.app;

import java.util.UUID;

/**
 * 분석이 완료 전이된 직후 불리는 포트. 분석은 듣는 쪽이 누구인지 모른다 —
 * 지금은 {@code push} 가 이것을 구현해 "질문이 준비됐어요" 를 보낸다.
 *
 * <p>통지는 분석의 결과에 영향을 주면 안 된다. {@link AnalysisWorker} 가 완료 전이
 * <b>후에</b> 부르고, 던져진 예외는 로그로만 남긴다 — 알림이 죽어도 분석은 완료다.
 */
public interface AnalysisCompletionListener {

    void onAnalysisComplete(UUID sessionId);
}
