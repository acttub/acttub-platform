package com.acttub.actingapi.platform.persistence;

import org.hibernate.dialect.PostgreSQLDialect;
import org.hibernate.engine.jdbc.dialect.spi.DialectResolutionInfo;

/**
 * JPA 로 거는 쓰기 잠금(PESSIMISTIC_WRITE)을 네이티브 SQL 과 같은 {@code FOR UPDATE} 로 낸다(apps/api/CONTRACT.md §5-2).
 *
 * <p>Hibernate 7.4 의 {@link PostgreSQLDialect} 는 이 잠금을 {@code FOR NO KEY UPDATE} 로 낸다. 그 잠금은 FK 로 이 행을
 * 가리키는 자식 행의 INSERT 를 막지 않는다(FK 검사가 거는 {@code FOR KEY SHARE} 와 부딪히지 않는다). 저장소의 네이티브 SQL 은
 * {@code FOR UPDATE} 로 잠그므로, 잠금을 JPA 로 옮겨도 막는 범위가 같도록 여기서 맞춘다. Hibernate 에는 이 문자열을 바꾸는
 * 설정이 없고, 방언의 {@link #getForUpdateString()} 하나가 쿼리·{@code find} 의 잠금 절과 NOWAIT·SKIP LOCKED 앞부분을 정한다.
 */
public class ForUpdatePostgreSQLDialect extends PostgreSQLDialect {

    /** Hibernate 가 연결에서 읽은 DB 버전과 드라이버로 만든다 — 방언을 지정하지 않았을 때 Hibernate 가 고르는 것과 같다. */
    public ForUpdatePostgreSQLDialect(DialectResolutionInfo info) {
        super(info);
    }

    @Override
    public String getForUpdateString() {
        return " for update";
    }
}
