package com.acttub.actingapi.feature.auth.adapter.db;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.schema.UserEntity;
import com.acttub.actingapi.platform.schema.IdentityProvider;
import com.acttub.actingapi.platform.schema.UserStatus;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface UserJpaRepository extends JpaRepository<UserEntity, UUID> {

    @Query("""
            SELECT user.id AS id,user.email AS email,user.status AS status
            FROM UserEntity user
            WHERE lower(user.email)=lower(:email)
            """)
    Optional<AuthenticatedUserProjection> findAuthenticatedByEmail(
            @Param("email") String email);

    @Query("""
            SELECT user.id AS id,user.email AS email,user.status AS status
            FROM UserEntity user,UserIdentityEntity identity
            WHERE identity.userId=user.id
              AND identity.provider=:provider
              AND identity.providerUid=:providerUid
            """)
    Optional<AuthenticatedUserProjection> findAuthenticatedByIdentity(
            @Param("provider") IdentityProvider provider,
            @Param("providerUid") String providerUid);

    /**
     * 요청마다 부르는 인증 확인 — 한 문장이다. 게스트 여부는 신원으로 판정한다: 신원이 있고 전부 {@code guest} 면 게스트다
     * ({@code users} 에 컬럼을 늘리지 않는다, account.guest).
     */
    @Query("""
            select new com.acttub.actingapi.platform.security.AuthenticatedUser(u.id, u.email, u.status,
                case when exists (select 1 from UserIdentityEntity i where i.userId = u.id)
                          and not exists (select 1 from UserIdentityEntity g where g.userId = u.id and g.provider <> :guest)
                     then true else false end)
            from UserEntity u
            where u.id = :id
            """)
    Optional<AuthenticatedUser> findAuthenticated(@Param("id") UUID id, @Param("guest") IdentityProvider guest);

    /** 옮겨진 게스트를 닫는다. 자기 트랜잭션을 열지 않는다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update UserEntity u set u.status = :status, u.deactivatedAt = :now, u.updatedAt = :now
            where u.id = :id
            """)
    int close(@Param("id") UUID id, @Param("status") UserStatus status, @Param("now") Instant now);

    /** 대소문자를 가리지 않고 아무도(자기 자신도) 쓰지 않는 이메일일 때만 바꾼다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update UserEntity u set u.email = :email, u.updatedAt = instant
            where u.id = :id
              and not exists (select 1 from UserEntity taken where lower(taken.email) = lower(:email))
            """)
    int updateEmailIfFree(@Param("id") UUID id, @Param("email") String email);

    /**
     * 그날(KST)의 접속일. 하루 한 줄이라 두 번째부터는 아무것도 하지 않는다. 탈퇴한 계정에는 쓰지 않는다. 앞선 변경을 먼저
     * 내보내 문장 순서를 지킨다.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into UserActiveDayEntity (userId, day)
            select u.id, :day from UserEntity u where u.id = :id and u.deactivatedAt is null
            on conflict do nothing
            """)
    int recordActiveDay(@Param("id") UUID id, @Param("day") LocalDate day);

    interface AuthenticatedUserProjection {
        UUID getId();

        String getEmail();

        UserStatus getStatus();
    }
}
