package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/** 댓글 노출. 신고 숨김은 hidden 이고 작성자에게만 "확인 중"으로 보인다. */
public enum EntryCommentStatus implements PgEnum {
    VISIBLE("visible"), HIDDEN("hidden");
    private final String value;
    EntryCommentStatus(String value) { this.value = value; }
    @Override public String dbValue() { return value; }
    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<EntryCommentStatus> {
        public JpaConverter() { super(EntryCommentStatus.class); }
    }
}
