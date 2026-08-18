package com.acttub.actingapi.feature.auth.schema;
import com.acttub.actingapi.platform.schema.*;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcType;

/**
 * {@code users} — M0 의 {@code ddl-auto: validate} 검증용 매핑 2종 중 하나.
 *
 * <p>관계 매핑({@code @ManyToOne} 등)을 만들지 않는다 (apps/api/CONTRACT.md §5-1).
 * PK 는 앱에서 {@code UUID.randomUUID()} 로 만들고 {@link Persistable} 로 신규 여부를 알려
 * {@code save()} 가 SELECT-then-INSERT 로 새지 않게 한다 (apps/api/CONTRACT.md §5-3-2).
 */
@Entity
@Table(name = "users")
public class UserEntity extends AppGeneratedUuidEntity {

    @Column(name = "email")
    private String email;

    @Convert(converter = UserStatus.JpaConverter.class)
    @JdbcType(PgEnumJdbcType.class)
    @Column(name = "status", nullable = false, columnDefinition = "user_status_t")
    private UserStatus status;

    @Column(name = "nickname")
    private String nickname;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    /** {@code save()} 직전까지만 true. 영속화 후에는 false 가 되어 재저장 시 merge 로 넘어간다. */
    protected UserEntity() {
    }

    public UserEntity(UUID id, String email, UserStatus status, String nickname) {
        super(id);
        this.email = email;
        this.status = status;
        this.nickname = nickname;
    }

    public String getEmail() {
        return email;
    }

    public UserStatus getStatus() {
        return status;
    }

    public String getNickname() {
        return nickname;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
