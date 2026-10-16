package com.acttub.actingapi.feature.coach.app;

/**
 * 코치 답을 쓰는 대로 화면에 보내는 통로(코칭 스트리밍). 스트리밍 요청에서만 주어지고, 없으면 지금처럼 다 쓴 뒤 한 번에 돌려준다.
 *
 * <p>{@link #begin} 은 모델을 부르기 직전에 한 번 불린다. 그 전의 거절(409·422·404)은 보통 HTTP 오류로 나가고,
 * 그 뒤의 실패는 스트림 안의 오류 이벤트로 나간다. {@link #delta} 로 나간 글은 배우에게 보인 글이고, 마지막에 저장된 답이
 * 따로 한 번 더 나간다 — 화면은 그것으로 덮어쓴다.
 */
public interface CoachStream {
    void begin();

    void delta(String text);
}
