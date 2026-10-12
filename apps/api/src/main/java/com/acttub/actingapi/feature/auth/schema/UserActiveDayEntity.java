package com.acttub.actingapi.feature.auth.schema;
import java.time.LocalDate;
import java.util.UUID;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
/** 회원이 들어온 날(KST) 한 줄. 쓰기는 {@code PostgresAuthRepository} 의 {@code ON CONFLICT DO NOTHING} 이다(V41). */
@Entity @Table(name = "user_active_days") @IdClass(UserActiveDayId.class)
public class UserActiveDayEntity {
    @Id @Column(name = "user_id", nullable = false) private UUID userId;
    @Id @Column(name = "day", nullable = false) private LocalDate day;
    protected UserActiveDayEntity() {}
}
