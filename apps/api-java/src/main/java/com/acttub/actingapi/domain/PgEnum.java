package com.acttub.actingapi.domain;

/**
 * 네이티브 Postgres enum 컬럼에 저장되는 값을 가진 Java enum.
 *
 * <p>Python 쪽 {@code sa.Enum(..., values_callable=...)} 때문에 DB 에 들어가는 문자열은
 * Python enum 의 {@code .value} 다 — Java enum 상수 이름과 다르다(소문자, 일부는 한글).
 * 그래서 {@code @Enumerated(EnumType.STRING)} 을 쓸 수 없고
 * {@link jakarta.persistence.AttributeConverter} 로만 매핑한다 (/SPEC.md §5-3-1).
 */
public interface PgEnum {

    /** DB 에 저장되는 값. */
    String dbValue();
}
