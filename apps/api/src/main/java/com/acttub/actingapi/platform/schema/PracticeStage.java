package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code practices.stage} 의 값 — 연습 회차의 진행 (practice.start).
 *
 * <p>분석 결과의 상태({@link AnalysisStatus})와 다른 것이다. 시작은 {@code analyzing}, 분석이 ready·partial 이면
 * {@code conversing}, 최종 실패·취소·대화 종료면 {@code closed} 다.
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum PracticeStage implements PgEnum {
    /** 분석이 돌고 있다. 명시적 재시도도 여기로 돌아온다. */
    ANALYZING("analyzing"),
    /** 분석이 끝나 코치와 대화할 수 있다. */
    CONVERSING("conversing"),
    /** 끝났다. 사유는 {@link PracticeCloseReason}. */
    CLOSED("closed");

    private final String dbValue;

    PracticeStage(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<PracticeStage> {
        public JpaConverter() {
            super(PracticeStage.class);
        }
    }
}
