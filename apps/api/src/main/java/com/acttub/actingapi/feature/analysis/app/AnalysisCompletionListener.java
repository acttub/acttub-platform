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

    /** 회차 주인도 함께 받는다(SOMA-780, 첫 질문 미리 쓰기). 회차만 필요한 쪽은 구현하지 않아도 된다. */
    default void onAnalysisComplete(UUID sessionId, UUID userId) {
        onAnalysisComplete(sessionId);
    }

    /**
     * 여럿에게 차례로 알린다(SOMA-780: 알림과 첫 질문 미리 쓰기). 하나가 실패해도 나머지는 받고, 실패는 모아 마지막에
     * 던진다 — 워커가 로그로 남긴다. 없으면 null 이다.
     */
    static AnalysisCompletionListener all(java.util.List<AnalysisCompletionListener> listeners) {
        if (listeners == null || listeners.isEmpty()) return null;
        if (listeners.size() == 1) return listeners.getFirst();
        var each = java.util.List.copyOf(listeners);
        return new AnalysisCompletionListener() {
            @Override
            public void onAnalysisComplete(UUID sessionId) {
                onAnalysisComplete(sessionId, null);
            }

            @Override
            public void onAnalysisComplete(UUID sessionId, UUID userId) {
                RuntimeException first = null;
                for (AnalysisCompletionListener listener : each) {
                    try {
                        listener.onAnalysisComplete(sessionId, userId);
                    } catch (RuntimeException failure) {
                        if (first == null) first = failure;
                        else first.addSuppressed(failure);
                    }
                }
                if (first != null) throw first;
            }
        };
    }
}
