package com.acttub.actingapi.platform.schema;

/**
 * DB 의 text 컬럼에 저장되는 값을 가진 Java enum.
 *
 * <p>DB 에 들어가는 문자열은 Java enum 상수 이름과 다르다 — 소문자이고 일부는 한글이다
 * (파이썬 시절 {@code sa.Enum(..., values_callable=...)} 이 남긴 값 규약이고, 값 자체가 계약이라
 * 그대로 이어받았다). 그래서 {@code @Enumerated(EnumType.STRING)} 을 쓸 수 없고
 * {@link jakarta.persistence.AttributeConverter} 로만 매핑한다 (apps/api/CONTRACT.md §5-3-1).
 *
 * <p>컬럼은 네이티브 Postgres enum 이 아니라 <b>text + CHECK</b> 다 (SOMA-462). 값 목록은
 * 그 CHECK 와 이 enum 이 각각 들고 있고, 둘이 어긋나면 {@link PgEnumConverter} 가 읽는 쪽에서
 * 예외를 던진다 — 기동할 때 카탈로그를 대조하던 검증기는 대조할 카탈로그가 없어져 은퇴했다.
 */
public interface PgEnum {

    /** DB 에 저장되는 값. */
    String dbValue();
}
