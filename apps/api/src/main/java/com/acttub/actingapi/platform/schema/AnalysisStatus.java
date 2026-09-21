package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code analyses.status} 의 값 — 관찰 기록이 어디까지 찼는가 (practice.analyze).
 *
 * <p>작업의 상태({@code ai_jobs.status})와 다른 것이다. 부분 실패는 {@code partial} 로 남기고 못 본 구간을 채우지
 * 않는다.
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum AnalysisStatus implements PgEnum {
    /** 구간을 모두 보았다. */
    READY("ready"),
    /** 일부 구간을 보지 못했다. 대화는 시작된다. */
    PARTIAL("partial");

    private final String dbValue;

    AnalysisStatus(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<AnalysisStatus> {
        public JpaConverter() {
            super(AnalysisStatus.class);
        }
    }
}
