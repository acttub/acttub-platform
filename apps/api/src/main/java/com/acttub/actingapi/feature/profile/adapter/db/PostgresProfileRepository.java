package com.acttub.actingapi.feature.profile.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.sql.Date;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.feature.profile.app.AccountCleanupRepository;
import com.acttub.actingapi.feature.profile.app.ProfileRepository;
import com.acttub.actingapi.feature.profile.domain.Account;
import com.acttub.actingapi.feature.profile.domain.AgeBand;
import com.acttub.actingapi.feature.profile.domain.NotificationSettings;
import com.acttub.actingapi.feature.profile.domain.Profile;
import com.acttub.actingapi.platform.schema.ActingDirection;
import com.acttub.actingapi.platform.schema.ActingExperience;
import com.acttub.actingapi.platform.schema.ActingGoal;
import com.acttub.actingapi.platform.schema.PgEnum;
import com.acttub.actingapi.platform.schema.ProfileGender;
import com.acttub.actingapi.platform.schema.UserStatus;
import com.acttub.actingapi.platform.security.AccountSecrets;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
class PostgresProfileRepository implements ProfileRepository {
    private static final ObjectMapper JSON = new ObjectMapper();

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;
    private final AccountSecrets secrets;

    PostgresProfileRepository(
            EntityManager entityManager,
            PlatformTransactionManager transactionManager,
            AccountSecrets secrets) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
        this.secrets = secrets;
    }

    /**
     * 계정 뼈대와 프로필을 한 번에 읽는다. 게이트가 요청마다 부르므로 질의는 하나다.
     *
     * <p>게스트 여부는 신원으로 판정한다 — 신원이 있고 전부 {@code guest} 면 게스트다. 프로필 행이
     * 없으면(LEFT JOIN 이 비면) 프로필은 {@code null} 이다.
     */
    @Override
    public Account find(UUID userId) {
        List<Tuple> rows = list(entityManager.createNativeQuery("""
                SELECT users.id,users.email,users.status,
                       (EXISTS (SELECT 1 FROM user_identities
                                WHERE user_identities.user_id=users.id)
                        AND NOT EXISTS (SELECT 1 FROM user_identities
                                        WHERE user_identities.user_id=users.id
                                          AND user_identities.provider<>'guest')) AS guest,
                       user_profiles.user_id AS profile_user_id,
                       user_profiles.name,user_profiles.gender,user_profiles.birth_date,
                       user_profiles.experience,user_profiles.goal,
                       user_profiles.photo_key,user_profiles.bio,
                       (SELECT string_agg(direction, ',' ORDER BY CASE direction
                                                                    WHEN 'media' THEN 1
                                                                    WHEN 'stage' THEN 2
                                                                  END)
                        FROM user_profile_directions
                        WHERE user_profile_directions.user_id=users.id) AS directions
                FROM users
                LEFT JOIN user_profiles ON user_profiles.user_id=users.id
                WHERE users.id=:userId
                """, Tuple.class)
                .setParameter("userId", userId));
        return rows.isEmpty() ? null : account(rows.getFirst());
    }

    /**
     * 아는 어휘인지 확인하고 DB 값을 그대로 돌려준다.
     *
     * <p><b>Domain Model 이 문자열을 들되 느슨해지지는 않게 하는 자리다.</b> 열거형은
     * {@code jakarta.persistence} 를 끌고 있어 {@code domain} 으로 들일 수 없지만, 그렇다고
     * 어휘 밖 값을 통과시키면 재편이 실패 경로를 넓힌다 — 스키마를 먼저 넓히고 코드를 나중에
     * 좁히는 배포 순서에서 <b>DB 에 값이 먼저, 자바가 나중</b>은 실제로 일어난다. 종전처럼
     * 여기서 터지고 500 이 난다. ({@code practice} 가 검증 없이 문자열을 쓰는 것은 그쪽이
     * 재편 전부터 그랬기 때문이고, 이 넷은 열거형이었다.)
     */
    private static String status(String raw) {
        return UserStatus.valueOf(raw.toUpperCase(Locale.ROOT)).dbValue();
    }

    /** 위와 같은 판단이다 — 아는 어휘인지 확인하고 DB 값을 그대로 돌려준다. 비어 있으면 {@code null}. */
    private static <E extends Enum<E> & PgEnum> String known(Class<E> vocabulary, String raw) {
        return raw == null ? null : Enum.valueOf(vocabulary, raw.toUpperCase(Locale.ROOT)).dbValue();
    }

    /**
     * 프로필 행은 처음 저장할 때 생기므로 upsert 다. 이름은 {@code user_profiles.name} 에만 쓴다 —
     * {@code users.nickname} 은 보지 않는다 (V7, apps/api/CONTRACT.md §5-1).
     *
     * <p>{@code INSERT … SELECT FROM users} 인 것은 없는 사용자를 FK 위반이 아니라 <b>0행</b>으로
     * 돌려받기 위해서다. 그래야 "없으면 {@code null}" 이 그대로 성립한다. 방향은 같은 트랜잭션에서
     * 통째로 갈아 끼운다 — 부분 저장은 없다.
     */
    @Override
    public Account saveProfile(UUID userId, Profile profile) {
        return transaction.execute(status -> {
            int saved = entityManager.createNativeQuery("""
                    INSERT INTO user_profiles(user_id,name,gender,birth_date,experience,goal,bio)
                    SELECT id,:name,:gender,:birthDate,:experience,:goal,CAST(:bio AS text)
                    FROM users
                    WHERE id=:userId
                    ON CONFLICT (user_id) DO UPDATE
                    SET name=EXCLUDED.name,gender=EXCLUDED.gender,birth_date=EXCLUDED.birth_date,
                        experience=EXCLUDED.experience,goal=EXCLUDED.goal,bio=EXCLUDED.bio,
                        updated_at=now()
                    """)
                    .setParameter("name", profile.name())
                    .setParameter("gender", profile.gender())
                    .setParameter("birthDate", Date.valueOf(profile.birthDate()))
                    .setParameter("experience", profile.experience())
                    .setParameter("goal", profile.goal())
                    // 소개는 비어 있을 수 있다. SELECT 목록의 NULL 파라미터는 타입을 추론하지 못해 CAST 한다.
                    .setParameter("bio", profile.bio())
                    .setParameter("userId", userId)
                    .executeUpdate();
            if (saved == 0) {
                return null;
            }
            entityManager.createNativeQuery("""
                    DELETE FROM user_profile_directions
                    WHERE user_id=:userId
                    """)
                    .setParameter("userId", userId)
                    .executeUpdate();
            for (String direction : profile.directions()) {
                entityManager.createNativeQuery("""
                        INSERT INTO user_profile_directions(user_id,direction)
                        VALUES (:userId,:direction)
                        """)
                        .setParameter("userId", userId)
                        .setParameter("direction", direction)
                        .executeUpdate();
            }
            return find(userId);
        });
    }

    @Override
    public NotificationSettings notificationSettings(UUID userId) {
        List<Tuple> rows = list(entityManager.createNativeQuery("""
                SELECT notify_analysis_done,notify_challenge,notify_evening_reminder
                FROM user_profiles
                WHERE user_id=:userId
                """, Tuple.class)
                .setParameter("userId", userId));
        return rows.isEmpty() ? null : settings(rows.getFirst());
    }

    /**
     * ⚠ {@code push_tokens} 의 주인은 {@code push} 다. 그래도 여기서 지우는 것은 "둘 다 꺼짐"과 "토큰
     * 없음"이 한 트랜잭션이어야 하기 때문이다 — 나누면 꺼 놓고도 알림이 오는 틈이 생긴다. 탈퇴의 교차
     * 도메인 정리와 같은 형태로 명시적 native DML 로 남긴다.
     */
    @Override
    public NotificationSettings updateNotificationSettings(
            UUID userId, Boolean analysisDone, Boolean challenge, Boolean eveningReminder) {
        return transaction.execute(status -> {
            List<Tuple> rows = list(entityManager.createNativeQuery("""
                    WITH changed AS (
                        UPDATE user_profiles
                        SET notify_analysis_done=COALESCE(CAST(:analysisDone AS boolean),notify_analysis_done),
                            notify_challenge=COALESCE(CAST(:challenge AS boolean),notify_challenge),
                            notify_evening_reminder=
                                COALESCE(CAST(:eveningReminder AS boolean),notify_evening_reminder),
                            updated_at=now()
                        WHERE user_id=:userId
                        RETURNING notify_analysis_done,notify_challenge,notify_evening_reminder
                    )
                    SELECT notify_analysis_done,notify_challenge,notify_evening_reminder FROM changed
                    """, Tuple.class)
                    .setParameter("analysisDone", analysisDone)
                    .setParameter("challenge", challenge)
                    .setParameter("eveningReminder", eveningReminder)
                    .setParameter("userId", userId));
            if (rows.isEmpty()) {
                return null;
            }
            NotificationSettings settings = settings(rows.getFirst());
            if (settings.pushesTurnedOff()) {
                entityManager.createNativeQuery("DELETE FROM push_tokens WHERE user_id=:userId")
                        .setParameter("userId", userId)
                        .executeUpdate();
            }
            return settings;
        });
    }

    private static NotificationSettings settings(Tuple row) {
        return new NotificationSettings(
                row.get("notify_analysis_done", Boolean.class),
                row.get("notify_challenge", Boolean.class),
                row.get("notify_evening_reminder", Boolean.class));
    }

    @Override
    public boolean beginPhotoUpload(UUID userId, PhotoUpload upload) {
        return Boolean.TRUE.equals(transaction.execute(status -> entityManager.createNativeQuery("""
                UPDATE user_profiles
                SET photo_upload_key=:objectKey,photo_upload_mime_type=:mimeType,
                    photo_upload_size_bytes=:sizeBytes,photo_upload_expires_at=:expiresAt,
                    updated_at=now()
                WHERE user_id=:userId
                """)
                .setParameter("objectKey", upload.objectKey())
                .setParameter("mimeType", upload.mimeType())
                .setParameter("sizeBytes", upload.sizeBytes())
                .setParameter("expiresAt", upload.expiresAt().atOffset(ZoneOffset.UTC))
                .setParameter("userId", userId)
                .executeUpdate() > 0));
    }

    @Override
    public PhotoUpload pendingPhotoUpload(UUID userId) {
        List<Tuple> rows = list(entityManager.createNativeQuery("""
                SELECT photo_upload_key,photo_upload_mime_type,
                       photo_upload_size_bytes,photo_upload_expires_at
                FROM user_profiles
                WHERE user_id=:userId
                  AND photo_upload_key IS NOT NULL
                """, Tuple.class)
                .setParameter("userId", userId));
        if (rows.isEmpty()) {
            return null;
        }
        Tuple row = rows.getFirst();
        return new PhotoUpload(
                row.get("photo_upload_key", String.class),
                row.get("photo_upload_mime_type", String.class),
                row.get("photo_upload_size_bytes", Long.class),
                row.get("photo_upload_expires_at", Instant.class));
    }

    /**
     * 옛 키를 <b>같은 문장에서</b> 돌려받는다 — 조회 후 쓰기로 나누면 두 완료가 겹쳤을 때 같은 옛
     * 사진을 두 번 지우려 한다 (apps/api/CONTRACT.md §5-2).
     */
    @Override
    public String completePhotoUpload(UUID userId, String objectKey) {
        return transaction.execute(status -> replacedPhoto(entityManager.createNativeQuery("""
                WITH before AS (
                    SELECT user_id,photo_key
                    FROM user_profiles
                    WHERE user_id=:userId
                      AND photo_upload_key=:objectKey
                    FOR UPDATE
                ), changed AS (
                    UPDATE user_profiles
                    SET photo_key=:objectKey,photo_upload_key=NULL,photo_upload_mime_type=NULL,
                        photo_upload_size_bytes=NULL,photo_upload_expires_at=NULL,updated_at=now()
                    FROM before
                    WHERE user_profiles.user_id=before.user_id
                    RETURNING before.photo_key AS replaced
                )
                SELECT replaced FROM changed
                """, Tuple.class)
                .setParameter("userId", userId)
                .setParameter("objectKey", objectKey)));
    }

    @Override
    public String clearPhoto(UUID userId) {
        return transaction.execute(status -> replacedPhoto(entityManager.createNativeQuery("""
                WITH before AS (
                    SELECT user_id,photo_key
                    FROM user_profiles
                    WHERE user_id=:userId
                      AND photo_key IS NOT NULL
                    FOR UPDATE
                ), changed AS (
                    UPDATE user_profiles
                    SET photo_key=NULL,updated_at=now()
                    FROM before
                    WHERE user_profiles.user_id=before.user_id
                    RETURNING before.photo_key AS replaced
                )
                SELECT replaced FROM changed
                """, Tuple.class)
                .setParameter("userId", userId)));
    }

    private static String replacedPhoto(jakarta.persistence.Query query) {
        List<Tuple> rows = list(query);
        return rows.isEmpty() ? null : rows.getFirst().get("replaced", String.class);
    }

    /**
     * 가입 중에 만 14세 미만으로 드러난 계정.
     *
     * <p>⚠ <b>남의 테이블을 여기서 함께 치는 것은 탈퇴와 같은 이유다</b> — 파기의 원자성이 트랜잭션
     * 하나를 요구한다. 자료가 있는지 보는 표는 {@code users} 를 FK 로 물고 있으면서 지우면 안 되는
     * 것들이다(연습·업로드·작업 장부·배우 기억, 그리고 1.0.0 이전에 쓴 커뮤니티 행). 하나라도 있으면
     * 행을 지울 수 없어 탈퇴와 같은 절차로 닫는다 — 그때는 보관 동의와 무관하게 영상을 파기한다.
     */
    @Override
    public Closed closeUnderage(UUID userId, Instant now, LocalDate today) {
        return transaction.execute(status -> {
            List<Tuple> rows = list(entityManager.createNativeQuery("""
                    SELECT (EXISTS (SELECT 1 FROM practice_sessions WHERE user_id=:userId)
                         OR EXISTS (SELECT 1 FROM upload_intents WHERE user_id=:userId)
                         OR EXISTS (SELECT 1 FROM external_operations WHERE user_id=:userId)
                         OR EXISTS (SELECT 1 FROM actor_memory_entries WHERE user_id=:userId)
                         OR EXISTS (SELECT 1 FROM account_cleanup_operations WHERE user_id=:userId)
                         OR EXISTS (SELECT 1 FROM community_posts WHERE author_id=:userId)
                         OR EXISTS (SELECT 1 FROM community_comments WHERE author_id=:userId)
                         OR EXISTS (SELECT 1 FROM community_post_likes WHERE user_id=:userId)
                         OR EXISTS (SELECT 1 FROM community_anonymous_aliases WHERE user_id=:userId)
                         OR EXISTS (SELECT 1 FROM community_reports WHERE reporter_id=:userId)
                         OR EXISTS (SELECT 1 FROM community_blocks
                                    WHERE blocker_id=:userId OR blocked_id=:userId)) AS has_history
                    FROM users
                    WHERE id=:userId
                    FOR UPDATE
                    """, Tuple.class)
                    .setParameter("userId", userId));
            if (rows.isEmpty()) {
                return null;
            }
            if (rows.getFirst().get("has_history", Boolean.class)) {
                Withdrawn withdrawn = withdraw(userId, true, now, today);
                return new Closed(Closure.DEACTIVATED, withdrawn.cleanupOperationIds());
            }
            for (String owned : List.of("user_consents", "refresh_tokens", "user_identities", "push_tokens")) {
                entityManager.createNativeQuery("DELETE FROM " + owned + " WHERE user_id=:userId")
                        .setParameter("userId", userId)
                        .executeUpdate();
            }
            // 프로필·방향·포트폴리오·이관 코드는 `ON DELETE CASCADE` 로 함께 지워진다.
            entityManager.createNativeQuery("DELETE FROM users WHERE id=:userId")
                    .setParameter("userId", userId)
                    .executeUpdate();
            return new Closed(Closure.ERASED, List.of());
        });
    }

    /**
     * 탈퇴 트랜잭션 (account.withdraw, ADR-029).
     *
     * <p>행을 지우지 않는다 — 연습 기록과 남의 화면에 얽힌 행이 {@code user_id} 를 참조하므로 지우면
     * 남의 흐름이 깨진다. 대신 바로 알아보게 하는 것을 파기하고, 나머지는 사람과 끊어 남긴다.
     * <b>상태 전환과 파기가 한 트랜잭션이다</b> — 나누면 중간 실패 시 "탈퇴했는데 refresh 는 살아
     * 있는" 계정이 남는다.
     *
     * <ul>
     *   <li>파기: 이메일, 프로필의 이름·사진·소개, 신원의 제공자 ID 와 토큰, 리프레시·푸시 토큰, 이관
     *       코드, 포트폴리오(행째).</li>
     *   <li>가명처리: 생년월일을 5세 단위 연령대로 뭉개고 원래 값은 지운다. 성별·방향·경력·목표와 배우
     *       기억은 남는다. 알림 토글은 끈다.</li>
     *   <li>신원은 서버 비밀키의 HMAC 만 {@code uid_hash} 에 남긴다. 해제에 쓸 값(애플 토큰, 카카오
     *       회원번호, 네이버 refresh token)은 <b>파기 전에</b> 정리 장부로 옮긴다.</li>
     *   <li>영상 객체는 "탈퇴 후 영상·녹음 보관·활용"에 동의한 사람 것만 남긴다. 현재 판에 답하지
     *       않았으면 거절로 본다. 사진 객체는 언제나 지운다. 객체 삭제도 장부로 간다.</li>
     *   <li>진행 중인 비동기 작업은 실패로 닫고 lease 를 뗀다 — 돌고 있던 워커의 완료는 lease 가
     *       맞지 않아 통째로 롤백되므로 결과가 저장되지 않는다.</li>
     * </ul>
     *
     * <p>챌린지 참여작을 비공개로 내리는 일은 그 테이블이 생길 때 여기에 더한다(지금 스키마에 없다).
     *
     * <p>⚠ <b>여기서 남의 테이블을 함께 치는 것은 의도한 것이다.</b> 테이블 주인은 각각 {@code auth}·
     * {@code push}·{@code portfolio}·{@code transfer}·{@code consent}·{@code upload}·작업 장부지만
     * 파기의 원자성이 트랜잭션 하나를 요구한다. 다른 feature의 Schema Entity를 import하면 패키지
     * 경계를 우회하므로 이 교차 도메인 정리는 명시적 native SQL 로 남긴다.
     *
     * <p>이미 탈퇴한 계정이면 <b>최초 탈퇴 시각을 유지</b>한다. 파기는 멱등하게 다시 돈다.
     */
    @Override
    public Withdrawn withdraw(UUID userId, boolean destroyMediaRegardless, Instant now, LocalDate today) {
        return transaction.execute(status -> {
            List<Tuple> current = list(entityManager.createNativeQuery("""
                    SELECT status
                    FROM users
                    WHERE id=:userId
                    FOR UPDATE
                    """, Tuple.class)
                    .setParameter("userId", userId));
            if (current.isEmpty()) {
                return null;
            }
            if (!"deactivated".equals(current.getFirst().get("status", String.class))) {
                entityManager.createNativeQuery("""
                        UPDATE users
                        SET status='deactivated',
                            deactivated_at=:now,
                            updated_at=:now
                        WHERE id=:userId
                        """)
                        .setParameter("now", now.atOffset(ZoneOffset.UTC))
                        .setParameter("userId", userId)
                        .executeUpdate();
            }
            List<UUID> cleanups = new ArrayList<>();
            List<String> objectKeys = new ArrayList<>(photoKeys(userId));
            if (destroyMediaRegardless || !retentionGranted(userId)) {
                objectKeys.addAll(videoKeys(userId));
            }
            if (!objectKeys.isEmpty()) {
                cleanups.add(enqueue(userId, "object_delete", secrets.encrypt(json(objectKeys)), now));
            }
            cleanups.addAll(hashIdentities(userId, now));

            // ⚠ 새 코드가 `users.nickname` 을 건드리는 곳은 이 한 줄뿐이다 (SOMA-528 결정 I-3).
            // V7 은 옛 닉네임을 `user_profiles.name` 으로 복사만 해서 값이 이 컬럼에도 남아 있고,
            // 탈퇴는 이름을 지체 없이 파기해야 한다. 컬럼을 지우려면 먼저 이 쓰기를 걷어낸 릴리스를
            // 내고(N+1), 그다음 릴리스에서 DROP COLUMN 한다(N+2) — 삭제와 그것을 안 쓰는 코드를
            // 한 릴리스에 묶지 않는다(docs/BRANCHING-STRATEGY.md 「DB와 배포 안전성」).
            entityManager.createNativeQuery("""
                    UPDATE users
                    SET email=NULL,nickname=NULL
                    WHERE id=:userId
                    """)
                    .setParameter("userId", userId)
                    .executeUpdate();
            blurProfile(userId, today);
            // 경력·사진 행은 `ON DELETE CASCADE` 로 따라 지워진다. 공유 링크는 이 순간부터 404 다.
            entityManager.createNativeQuery("DELETE FROM portfolios WHERE user_id=:userId")
                    .setParameter("userId", userId)
                    .executeUpdate();
            // 살아 있는 이관 코드만 지운다. 쓰인 코드는 "이 게스트는 옮겨졌다"는 표식이라 남긴다
            // (그 게스트의 토큰으로 온 요청에 guest_transferred 를 답한다).
            entityManager.createNativeQuery(
                    "DELETE FROM guest_transfer_codes WHERE user_id=:userId AND used_at IS NULL")
                    .setParameter("userId", userId)
                    .executeUpdate();
            entityManager.createNativeQuery("""
                    UPDATE refresh_tokens
                    SET revoked_at=:now
                    WHERE user_id=:userId
                      AND revoked_at IS NULL
                    """)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("userId", userId)
                    .executeUpdate();
            entityManager.createNativeQuery("""
                    DELETE FROM push_tokens
                    WHERE user_id=:userId
                    """)
                    .setParameter("userId", userId)
                    .executeUpdate();
            cancelOperations(userId, now);

            Instant deactivatedAt = list(entityManager.createNativeQuery("""
                    SELECT deactivated_at
                    FROM users
                    WHERE id=:userId
                    """, Tuple.class)
                    .setParameter("userId", userId)).getFirst().get("deactivated_at", Instant.class);
            return new Withdrawn(deactivatedAt, List.copyOf(cleanups));
        });
    }

    /** 프로필 사진(대기 중인 올리기 포함)과 포트폴리오 사진의 객체 키. 사진은 보관 동의와 무관하게 지운다. */
    private List<String> photoKeys(UUID userId) {
        return list(entityManager.createNativeQuery("""
                SELECT photo_key AS object_key FROM user_profiles
                WHERE user_id=:userId AND photo_key IS NOT NULL
                UNION ALL
                SELECT photo_upload_key FROM user_profiles
                WHERE user_id=:userId AND photo_upload_key IS NOT NULL
                UNION ALL
                SELECT object_key FROM portfolio_photos
                WHERE user_id=:userId
                """, Tuple.class)
                .setParameter("userId", userId)).stream()
                .map(row -> row.get("object_key", String.class))
                .toList();
    }

    /**
     * 이 사람이 올린 영상의 객체 키. 연습 행은 남기고 객체만 지운다 — 얼굴과 목소리는 가명처리가 안
     * 된다. 지금 서버가 맡아 둔 녹음은 없다(리딩 녹음은 그 영역이 서버에 붙을 때 여기에 더한다).
     */
    private List<String> videoKeys(UUID userId) {
        return list(entityManager.createNativeQuery("""
                SELECT object_key
                FROM upload_intents
                WHERE user_id=:userId
                """, Tuple.class)
                .setParameter("userId", userId)).stream()
                .map(row -> row.get("object_key", String.class))
                .toList();
    }

    /**
     * 보관 문서의 <b>현재 판</b>에 대한 마지막 결정이 동의인가. 현재 판에 답하지 않았으면(새 판이
     * 나온 뒤 결정 전에 탈퇴) 거절로 본다 — 동의 없이 얼굴을 남기지 않는 쪽이 안전하다.
     */
    private boolean retentionGranted(UUID userId) {
        return !list(entityManager.createNativeQuery("""
                SELECT 1 AS granted
                FROM (SELECT id
                      FROM consent_documents
                      WHERE type='retention'
                      ORDER BY published_at DESC,id DESC
                      LIMIT 1) current_document
                JOIN LATERAL (SELECT action
                              FROM user_consents
                              WHERE user_consents.user_id=:userId
                                AND user_consents.document_id=current_document.id
                              ORDER BY occurred_at DESC,id DESC
                              LIMIT 1) last_decision ON true
                WHERE last_decision.action='granted'
                """, Tuple.class)
                .setParameter("userId", userId)).isEmpty();
    }

    /**
     * 신원마다 해시만 남기고 제공자 ID 와 토큰을 비운다. 그 전에 서버가 해제해야 하는 제공자의 값을
     * 장부로 옮긴다 — 애플은 토큰으로 폐기하고, 카카오는 회원번호로 끊고, 네이버는 refresh token 을
     * 폐기한다. 구글은 앱이 탈퇴 요청 직전에 SDK 로 끊는다.
     *
     * <p>이미 해시로 바뀐 신원(다시 온 탈퇴 요청)은 건드리지 않는다. 게스트 신원은 해시를 남기지 않고 지운다.
     */
    private List<UUID> hashIdentities(UUID userId, Instant now) {
        List<UUID> cleanups = new ArrayList<>();
        List<Tuple> identities = list(entityManager.createNativeQuery("""
                SELECT id,provider,provider_uid,apple_token_encrypted,naver_token_encrypted
                FROM user_identities
                WHERE user_id=:userId
                  AND provider_uid IS NOT NULL
                FOR UPDATE
                """, Tuple.class)
                .setParameter("userId", userId));
        for (Tuple identity : identities) {
            String provider = identity.get("provider", String.class);
            String providerUid = identity.get("provider_uid", String.class);
            // 게스트 신원은 해시 없이 행째 지운다(account.guest). 서버가 만든 난수라 다시 올 사람이 없고,
            // 해시의 쓰임인 보관 동의 철회도 게스트에게는 없다(선택 문서를 묻지 않는다).
            if ("guest".equals(provider)) {
                entityManager.createNativeQuery("DELETE FROM user_identities WHERE id=:id")
                        .setParameter("id", identity.get("id", UUID.class))
                        .executeUpdate();
                continue;
            }
            String appleToken = identity.get("apple_token_encrypted", String.class);
            String naverToken = identity.get("naver_token_encrypted", String.class);
            // 토큰은 이미 암호문이라 그대로 옮긴다. 카카오 회원번호는 평문이었으므로 여기서 암호화한다.
            if ("apple".equals(provider) && appleToken != null) {
                cleanups.add(enqueue(userId, "apple_revoke", appleToken, now));
            } else if ("naver".equals(provider) && naverToken != null) {
                cleanups.add(enqueue(userId, "naver_revoke", naverToken, now));
            } else if ("kakao".equals(provider)) {
                cleanups.add(enqueue(userId, "kakao_unlink", secrets.encrypt(providerUid), now));
            }
            entityManager.createNativeQuery("""
                    UPDATE user_identities
                    SET uid_hash=:uidHash,provider_uid=NULL,
                        apple_token_encrypted=NULL,naver_token_encrypted=NULL
                    WHERE id=:id
                    """)
                    .setParameter("uidHash", secrets.identityHash(provider, providerUid))
                    .setParameter("id", identity.get("id", UUID.class))
                    .executeUpdate();
        }
        return cleanups;
    }

    /** 이름·사진·소개를 지우고 생년월일을 연령대로 뭉갠다. 이미 뭉갠 프로필은 연령대를 그대로 둔다. */
    private void blurProfile(UUID userId, LocalDate today) {
        List<Tuple> rows = list(entityManager.createNativeQuery("""
                SELECT birth_date
                FROM user_profiles
                WHERE user_id=:userId
                FOR UPDATE
                """, Tuple.class)
                .setParameter("userId", userId));
        if (rows.isEmpty()) {
            return;
        }
        Date birthDate = rows.getFirst().get("birth_date", Date.class);
        entityManager.createNativeQuery("""
                UPDATE user_profiles
                SET name=NULL,photo_key=NULL,bio=NULL,birth_date=NULL,
                    age_band=COALESCE(CAST(:ageBand AS integer),age_band),
                    photo_upload_key=NULL,photo_upload_mime_type=NULL,
                    photo_upload_size_bytes=NULL,photo_upload_expires_at=NULL,
                    notify_analysis_done=false,notify_challenge=false,notify_evening_reminder=false,
                    updated_at=now()
                WHERE user_id=:userId
                """)
                .setParameter("ageBand", birthDate == null ? null : AgeBand.of(birthDate.toLocalDate(), today))
                .setParameter("userId", userId)
                .executeUpdate();
    }

    /**
     * 진행 중인 비동기 작업(분석·코치·노트·기억 갱신)을 실패로 닫는다. 분석 중이던 연습도 함께 닫는다.
     * lease 를 떼므로 돌고 있던 워커의 완료는 받아들여지지 않는다(CONTRACT.md §5-7).
     */
    private void cancelOperations(UUID userId, Instant now) {
        entityManager.createNativeQuery("""
                UPDATE practice_sessions
                SET status='failed',updated_at=:now
                WHERE user_id=:userId
                  AND status='analyzing'
                """)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("userId", userId)
                .executeUpdate();
        entityManager.createNativeQuery("""
                UPDATE external_operations
                SET status='failed',error_code='account_deactivated',
                    lease_token=NULL,lease_expires_at=NULL,monitoring_lease_token=NULL,
                    updated_at=:now
                WHERE user_id=:userId
                  AND status IN ('pending','running')
                """)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("userId", userId)
                .executeUpdate();
    }

    private UUID enqueue(UUID userId, String kind, String payloadEncrypted, Instant now) {
        UUID id = UUID.randomUUID();
        entityManager.createNativeQuery("""
                INSERT INTO account_cleanup_operations(
                    id,user_id,kind,payload_encrypted,next_attempt_at,expires_at,created_at,updated_at)
                VALUES (:id,:userId,:kind,:payload,:now,:expiresAt,:now,:now)
                """)
                .setParameter("id", id)
                .setParameter("userId", userId)
                .setParameter("kind", kind)
                .setParameter("payload", payloadEncrypted)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("expiresAt", now.plus(AccountCleanupRepository.RETRY_WINDOW).atOffset(ZoneOffset.UTC))
                .executeUpdate();
        return id;
    }

    private static String json(List<String> values) {
        try {
            return JSON.writeValueAsString(values);
        } catch (Exception failure) {
            throw new IllegalStateException("failed to write object keys", failure);
        }
    }

    private static Account account(Tuple row) {
        return new Account(
                row.get("id", UUID.class),
                row.get("email", String.class),
                status(row.get("status", String.class)),
                row.get("guest", Boolean.class) ? "guest" : "member",
                row.get("profile_user_id", UUID.class) == null ? null : profile(row));
    }

    private static Profile profile(Tuple row) {
        String directions = row.get("directions", String.class);
        Date birthDate = row.get("birth_date", Date.class);
        return new Profile(
                row.get("name", String.class),
                known(ProfileGender.class, row.get("gender", String.class)),
                birthDate == null ? null : birthDate.toLocalDate(),
                directions == null
                        ? List.of()
                        : Arrays.stream(directions.split(","))
                                .map(direction -> known(ActingDirection.class, direction))
                                .toList(),
                known(ActingExperience.class, row.get("experience", String.class)),
                known(ActingGoal.class, row.get("goal", String.class)),
                row.get("photo_key", String.class),
                row.get("bio", String.class));
    }
}
