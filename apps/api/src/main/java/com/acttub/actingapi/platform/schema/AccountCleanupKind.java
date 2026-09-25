package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code account_cleanup_operations.kind} 의 값 — 탈퇴 트랜잭션 밖에서 하는 정리의 종류 (account.withdraw).
 *
 * <p>값 이름은 DB CHECK 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum AccountCleanupKind implements PgEnum {
    /** 저장소의 객체(영상·사진) 삭제. */
    OBJECT_DELETE("object_delete"),
    /** 애플 토큰 폐기. */
    APPLE_REVOKE("apple_revoke"),
    /** 카카오 연결 끊기. */
    KAKAO_UNLINK("kakao_unlink"),
    /** 네이버 토큰 폐기(연동 해제). */
    NAVER_REVOKE("naver_revoke"),
    /**
     * 리딩 녹음 객체 삭제(reading.recording) — 대본·회차 삭제, 같은 줄의 다시 말하기(대체), 탈퇴 파기, 변환
     * 결과를 반영하지 못한 객체. 값은 {@code object_delete} 와 같은 객체 키 목록이다.
     */
    READING_RECORDING_DELETE("reading_recording_delete");

    private final String dbValue;

    AccountCleanupKind(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<AccountCleanupKind> {
        public JpaConverter() {
            super(AccountCleanupKind.class);
        }
    }
}
