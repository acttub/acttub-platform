package com.acttub.actingapi.feature.coach.app;

import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 응답으로 나갈 본문과 그 응답이 되짚을 요청 ID.
 *
 * <p>요청 ID 가 함께 나오는 이유는 <b>같은 요청이 두 번 들어왔을 때</b>다 — 재생 응답은 처음
 * 요청의 ID 를 그대로 달고 나가야 클라이언트가 자기 요청과 짝지을 수 있다.
 */
public record CoachPayload(JsonNode body, UUID requestId) {
}
