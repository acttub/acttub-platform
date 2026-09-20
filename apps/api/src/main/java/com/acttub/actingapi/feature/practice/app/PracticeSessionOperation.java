package com.acttub.actingapi.feature.practice.app;

/**
 * 세션 생성·재분석 멱등 처리 결과.
 *
 * @param quotaExceeded 게스트의 하루 분석 한도에 걸려 아무것도 만들지 않았다. 이때 나머지는 비어 있다
 */
public record PracticeSessionOperation(
        PracticeSessionRow session,
        ExternalOperationRow operation,
        boolean created,
        boolean fingerprintMismatch,
        boolean quotaExceeded) {

    public PracticeSessionOperation(
            PracticeSessionRow session, ExternalOperationRow operation, boolean created, boolean fingerprintMismatch) {
        this(session, operation, created, fingerprintMismatch, false);
    }

    public static PracticeSessionOperation overQuota() {
        return new PracticeSessionOperation(null, null, false, false, true);
    }
}
