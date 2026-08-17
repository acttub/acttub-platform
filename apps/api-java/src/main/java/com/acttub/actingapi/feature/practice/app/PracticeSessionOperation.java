package com.acttub.actingapi.feature.practice.app;

/** 세션 생성·재분석 멱등 처리 결과. */
public record PracticeSessionOperation(
        PracticeSessionRow session,
        ExternalOperationRow operation,
        boolean created,
        boolean fingerprintMismatch) {
}
