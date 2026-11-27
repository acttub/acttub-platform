package com.acttub.actingapi.platform.ledger;

/**
 * 작업의 상태({@code ai_jobs.status})가 넘어가는 길 전부. 정본은 docs/specs/common.md 「공통 상태」다.
 *
 * <p>상태를 바꾸는 UPDATE 는 {@code PostgresAiJobLedger} 한 파일에만 있고, 그 문장들이 이 표와 맞는지
 * {@code StateTransitionTest} 가 본다. 작업을 만들 때의 첫 상태({@code pending})는 전이가 아니라 여기 없다. 끝 상태는
 * {@code succeeded}·{@code failed} 다 — 재시도는 같은 행을 되살리지 않고 새 작업을 만든다.
 */
public enum AiJobStatusTransition {
    /** 워커가 집었다(시도 수 +1). lease 가 지난 실행 중 작업을 다시 집는 것은 상태가 그대로라 전이가 아니다. */
    CLAIMED("pending", "running"),
    /** 완료. lease 가 그대로일 때만 통한다. */
    SUCCEEDED("running", "succeeded"),
    /** 일시 실패로 놓았다. 시도 수는 되돌리지 않는다. */
    RELEASED("running", "pending"),
    /** 실행 중에 끝났다: 즉시 실패, 시도를 다 쓴 채 lease 가 지남, 취소·연습 삭제·탈퇴. */
    FAILED_WHILE_RUNNING("running", "failed"),
    /** 대기 중에 끝났다: 시도 소진 뒤 정리, 취소·연습 삭제·탈퇴. */
    FAILED_WHILE_PENDING("pending", "failed");

    private final String from;
    private final String to;

    AiJobStatusTransition(String from, String to) {
        this.from = from;
        this.to = to;
    }

    public String from() {
        return from;
    }

    public String to() {
        return to;
    }
}
