package com.acttub.actingapi.memory.domain;

import java.util.List;

/**
 * 에이전트가 배우 기억에 손댈 수 있는 범위.
 *
 * <p><b>성별·나이는 배우 전용이다.</b> 영상이나 말투에서 추론하는 순간 틀릴 수 있고, 틀린 채로
 * 다음 연습의 전제가 된다.
 *
 * <p>이 규칙은 종전에 세 곳에 흩어져 있었다 — 뽑는 쪽의 후보 목록, 저장 계층의 가드,
 * 프롬프트 문구. 앞의 둘을 여기로 모은다. 프롬프트는 모델에게 하는 말이라 문장으로 남고,
 * <b>DB 제약이 최종 방어선인 것도 그대로다</b>.
 */
public final class AgentMemoryWrites {

    /** 에이전트가 손대는 칸. 순서는 프롬프트에 실리는 순서다. */
    public static final List<String> FIELDS =
            List.of("goal", "blockage", "speech_self", "speech_actual");

    private AgentMemoryWrites() {
    }

    /** 이 칸을 에이전트가 쓸 수 있는가. 인자는 DB 에 저장되는 값(`gender`·`goal` …)이다. */
    public static boolean allows(String field) {
        return FIELDS.contains(field);
    }
}
