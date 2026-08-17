package com.acttub.actingapi.feature.practice.app;

import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 세션 생성·재분석 요청이 낸 결과. 같은 요청이 두 번 와도 답이 하나여야 하므로(멱등), 무엇을
 * 돌려줄지는 새로 만들었는지가 아니라 <b>원장에 남은 작업의 상태</b>가 정한다.
 *
 * <p>상태코드는 여기 없다. 그것은 HTTP 의 어휘이고, 어느 결과가 어느 코드가 되는지는
 * 컨트롤러가 정한다.
 */
public sealed interface AnalysisOutcome {

    /** 분석이 걸렸다(또는 이미 걸려 있다). */
    record Accepted(UUID sessionId) implements AnalysisOutcome {
    }

    /** 이미 끝난 작업인데 저장된 응답이 없어, 세션의 현재 상태로 답한다. */
    record Completed(UUID sessionId, String status) implements AnalysisOutcome {
    }

    /**
     * 이미 끝난 작업이라 원장에 저장해 둔 응답을 그대로 돌려준다.
     *
     * <p>이 바이트열이 첫 응답과 같아야 멱등이 성립하므로, 다시 만들지 않고 저장된 것을 싣는다.
     */
    record Replayed(JsonNode payload) implements AnalysisOutcome {
    }
}
