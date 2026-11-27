package com.acttub.actingapi.feature.profile.schema;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * {@code user_discovery_answers}(V38, SOMA-649) — 가입 직후 답한 유입 경로. 계정마다 한 줄이고 처음 답만 남는다. 건너뛰면 세 칸이 모두
 * NULL 인 줄이다. 값 목록은 domain 의 {@code DiscoveryAnswer} 상수가 들고 DB CHECK 가 지킨다(Java enum 이 없어 문자열로 매핑한다).
 *
 * <p>넣기는 HQL {@code insert … on conflict (userId) do nothing}, 지우기는 HQL 이다.
 */
@Entity
@Table(name = "user_discovery_answers")
public class UserDiscoveryAnswerEntity {

    @Id
    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "source")
    private String source;

    @Column(name = "detail")
    private String detail;

    @Column(name = "other_text")
    private String otherText;

    @Column(name = "answered_at", nullable = false, insertable = false, updatable = false)
    private Instant answeredAt;

    protected UserDiscoveryAnswerEntity() {
    }
}
