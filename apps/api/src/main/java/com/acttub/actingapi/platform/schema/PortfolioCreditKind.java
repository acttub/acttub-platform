package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code portfolio_credits.kind} 의 값 — 경력의 종류 (account.portfolio).
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum PortfolioCreditKind implements PgEnum {
    FILM("film"),
    DRAMA("drama"),
    PLAY("play"),
    MUSICAL("musical"),
    AD("ad"),
    OTHER("other");

    private final String dbValue;

    PortfolioCreditKind(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<PortfolioCreditKind> {
        public JpaConverter() {
            super(PortfolioCreditKind.class);
        }
    }
}
