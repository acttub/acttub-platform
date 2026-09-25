package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code practices.experience_version} 의 값 — 그 회차가 탄 코칭 갈래 (practice.start, ADR-027).
 *
 * <p>서버의 신형 생성 플래그가 켜져 있고 계약 헤더가 {@code three_layers_v1} 일 때만 신형이다. 회차마다 고정이며
 * 뒤에 바꾸지 않는다 — 대화·노트의 형식이 여기서 갈린다.
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum ExperienceVersion implements PgEnum {
    /** 현행 갈래(분석·표현). 노트 종류는 analysis·expression 이다. */
    LEGACY("legacy"),
    /** 세 겹 신형. 노트 종류는 action·observation·record_only 다. */
    THREE_LAYERS_V1("three_layers_v1");

    private final String dbValue;

    ExperienceVersion(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<ExperienceVersion> {
        public JpaConverter() {
            super(ExperienceVersion.class);
        }
    }
}
