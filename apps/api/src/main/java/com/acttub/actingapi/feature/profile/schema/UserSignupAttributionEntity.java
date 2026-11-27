package com.acttub.actingapi.feature.profile.schema;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * {@code user_signup_attributions}(V26·V28·V44) — 가입 유입 출처. 계정마다 한 줄이고 처음 온 값만 남는다. 출처·플랫폼·적은 쪽의
 * 값 목록은 컨트롤러와 domain 의 상수가 거르고 DB CHECK 가 지킨다(Java enum 이 없어 문자열로 매핑한다).
 *
 * <p>넣기는 HQL {@code insert … on conflict (userId) do nothing}, 지우기는 HQL 이다({@code PostgresProfileRepository}).
 */
@Entity
@Table(name = "user_signup_attributions")
public class UserSignupAttributionEntity {

    @Id
    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "source", nullable = false)
    private String source;

    @Column(name = "platform", nullable = false)
    private String platform;

    @Column(name = "channel", nullable = false)
    private String channel;

    @Column(name = "medium")
    private String medium;

    @Column(name = "campaign")
    private String campaign;

    @Column(name = "ad_group")
    private String adGroup;

    @Column(name = "ad_creative")
    private String adCreative;

    @Column(name = "content")
    private String content;

    @Column(name = "term")
    private String term;

    @Column(name = "sub_publisher")
    private String subPublisher;

    @Column(name = "recorded_at", nullable = false, insertable = false, updatable = false)
    private Instant recordedAt;

    @Column(name = "recorded_via", nullable = false)
    private String recordedVia;

    protected UserSignupAttributionEntity() {
    }
}
