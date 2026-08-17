package com.acttub.actingapi.feature.practice.domain;

/**
 * 상태 조회의 답.
 *
 * <p>{@code errorCode} 는 세션이 실패 상태일 때만 채워지며, 그 외에는 {@code null} 인 채로 응답에
 * 키가 실려 나간다 — 키를 빼면 계약이 깨진다.
 */
public record AnalysisStatus(String status, String errorCode) {
}
