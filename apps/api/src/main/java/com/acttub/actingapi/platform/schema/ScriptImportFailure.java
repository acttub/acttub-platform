package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code script_imports.failure} 의 값 — 나누기 작업이 대본을 만들지 못한 이유 (reading.script).
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum ScriptImportFailure implements PgEnum {
    /** 첫 호출이 배역과 대사가 있는 글이 아니라고 봤다 — 소설·기사·목록. */
    NOT_SCRIPT("not_script"),
    /** 나눴더니 말하는 배역이 하나도 없다. */
    NO_CHARACTERS("no_characters"),
    /** 나눈 결과가 대본 한도(줄 3,000·배역 50·본문 총량)를 넘는다. */
    SCRIPT_TOO_LONG("script_too_long"),
    /** 저장할 때 대본 수 한도에 걸렸다. */
    SCRIPT_LIMIT("script_limit"),
    /** 모델 호출이 재시도 뒤에도 실패했다. */
    FAILED("failed");

    private final String dbValue;

    ScriptImportFailure(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<ScriptImportFailure> {
        public JpaConverter() {
            super(ScriptImportFailure.class);
        }
    }
}
