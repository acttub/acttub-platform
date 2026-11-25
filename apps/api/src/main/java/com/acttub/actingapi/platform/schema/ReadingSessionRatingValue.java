package com.acttub.actingapi.platform.schema;

/**
 * {@code reading_session_ratings.rating} 의 값 — 리딩 회차에 남긴 "좋았어요·아쉬웠어요" (reading.session, V40).
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum ReadingSessionRatingValue implements PgEnum {
    /** 좋았어요. */
    GOOD("good"),
    /** 아쉬웠어요. */
    BAD("bad");

    private final String dbValue;

    ReadingSessionRatingValue(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }
}
