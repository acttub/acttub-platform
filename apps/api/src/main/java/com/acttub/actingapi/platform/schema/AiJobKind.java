package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code ai_jobs.kind} 의 값 — 비동기 AI 요청의 종류 (practice.analyze, practice.memory).
 *
 * <p><b>둘뿐이다.</b> 리딩·설문 전송·정리 장부는 AI 요청이 아니라 여기 넣지 않는다. 옛 {@link OperationKind} 는
 * 코치 시작·답·리포트까지 다섯이고 옛 테이블이 계속 쓴다.
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum AiJobKind implements PgEnum {
    /** 영상 분석. 대상은 회차다. */
    ANALYZE("analyze"),
    /** 배우 기억 갱신. 대상은 회차이고 예약 시점의 기억 세대를 함께 든다. */
    MEMORY_UPDATE("memory_update");

    private final String dbValue;

    AiJobKind(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<AiJobKind> {
        public JpaConverter() {
            super(AiJobKind.class);
        }
    }
}
