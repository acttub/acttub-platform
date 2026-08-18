package com.acttub.actingapi.feature.practice.app;

import java.util.UUID;

/**
 * 세션을 하나 만들어 달라는 요청.
 *
 * <p>요청 DTO 를 그대로 넘기지 않는다 — DTO 는 JSON 표기(스네이크 케이스·unknown key 거부)를
 * 지고 있고, 그 표기는 HTTP 어댑터의 사정이다.
 */
public record NewPracticeSession(
        UUID uploadIntentId,
        String situation,
        String characterContext,
        String goal,
        String blockageKind,
        String subBranch,
        String blockageDetail,
        // 끝난 연습에서 "이어서 새 연습" 으로 시작했다면 그 연습. 코치가 이 연습의
        // 대화를 이어받는다. 없으면 가장 최근 대화를 이어받는다 (SOMA-417).
        UUID continuedFrom) {
}
