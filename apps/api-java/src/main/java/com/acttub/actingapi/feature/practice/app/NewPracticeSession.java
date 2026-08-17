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
        String blockageDetail) {
}
