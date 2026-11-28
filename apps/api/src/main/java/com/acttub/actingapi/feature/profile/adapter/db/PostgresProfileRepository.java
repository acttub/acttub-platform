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

import com.acttub.actingapi.feature.auth.app.AccountErasureSequence;
import com.acttub.actingapi.feature.auth.app.AccountRowLock;
import com.acttub.actingapi.feature.auth.app.RetentionPurge;
import com.acttub.actingapi.feature.challenge.app.EntryMediaPurge;
import com.acttub.actingapi.feature.profile.app.DiscoveryAnswerOwnership;
import com.acttub.actingapi.feature.profile.app.ProfileRepository;
import com.acttub.actingapi.feature.profile.app.SignupAttributionOwnership;
import com.acttub.actingapi.feature.push.app.PushTokenRevocation;
import com.acttub.actingapi.feature.profile.domain.Account;
import com.acttub.actingapi.feature.profile.domain.DiscoveryAnswer;
import com.acttub.actingapi.feature.profile.domain.NotificationSettings;
import com.acttub.actingapi.feature.profile.domain.Profile;
import com.acttub.actingapi.feature.profile.domain.SignupAttribution;
import com.acttub.actingapi.feature.reading.app.RetainedRecordings;
import com.acttub.actingapi.feature.video.app.VideoRetention;
import com.acttub.actingapi.platform.schema.ActingDirection;
import com.acttub.actingapi.platform.schema.ActingExperience;
import com.acttub.actingapi.platform.schema.ActingGoal;
import com.acttub.actingapi.platform.schema.PgEnum;
import com.acttub.actingapi.platform.schema.ProfileGender;
import com.acttub.actingapi.platform.schema.UserStatus;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
class PostgresProfileRepository
        implements ProfileRepository, SignupAttributionOwnership, DiscoveryAnswerOwnership {

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;
    private final PostgresObjectCleanupLedger cleanups;

    /** 알림을 모두 끌 때 푸시 토큰을 지우는 주인. */
    private final PushTokenRevocation pushTokens;

    /** 탈퇴 3년 뒤, 보관 동의로 남겨 두었던 영상을 파기한 것으로 적는 주인. */
    private final VideoRetention retainedVideos;

    /** 탈퇴 3년 뒤의 파기에서 계정 행과 신원 해시를 고치는 주인. */
    private final RetentionPurge retentionPurge;

    /** 탈퇴 3년 뒤, 보관 동의로 남겨 두었던 참여작의 모자이크본·공유 프레임 객체를 지우는 주인. */
    private final EntryMediaPurge retainedEntryMedia;

    /** 탈퇴 3년 뒤, 보관 동의로 남겨 두었던 리딩 녹음을 지우는 주인. */
    private final RetainedRecordings retainedRecordings;

    /** 계정을 닫는 순서. 표는 각 주인이 고치고 이 저장소는 트랜잭션만 연다. */
    private final AccountErasureSequence closing;

    private final AccountRowLock accountRows;

    PostgresProfileRepository(
            EntityManager entityManager,
            PlatformTransactionManager transactionManager,
            PostgresObjectCleanupLedger cleanups,
            PushTokenRevocation pushTokens,
            VideoRetention retainedVideos,
            RetentionPurge retentionPurge,
            EntryMediaPurge retainedEntryMedia,
            RetainedRecordings retainedRecordings,
            AccountErasureSequence closing,
            AccountRowLock accountRows) {
        this.accountRows = accountRows;
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
        this.cleanups = cleanups;
        this.pushTokens = pushTokens;
        this.retainedVideos = retainedVideos;
        this.retentionPurge = retentionPurge;
        this.retainedEntryMedia = retainedEntryMedia;
        this.retainedRecordings = retainedRecordings;
        this.closing = closing;
    }

    /**
     * 회원 자료를 쓰는 트랜잭션의 첫 문장. 탈퇴({@link #withdraw})가 잡는 것과 <b>같은 {@code users} 행</b>을
     * 잡고 활성인지 본다.
     *
     * <p>게이트의 계정 상태 확인은 요청의 앞머리에서 끝난다. 그 뒤에 다른 기기의 탈퇴가 커밋되면, 이 확인이
     * 없는 쓰기는 파기한 이름·생년월일·사진 키를 다시 채운다 — 탈퇴는 {@code users} 행을 남기므로 FK 도 막지
     * 못한다. 행을 잡으면 둘은 줄을 선다: 쓰기가 먼저면 탈퇴가 그 뒤에 파기하고, 탈퇴가 먼저면 여기서 거짓이다.
     *
     * @return 없거나 활성이 아니면 {@code false} — 아무것도 쓰지 않는다
     */
    private boolean lockActive(UUID userId) {
        return accountRows.lockActive(userId);
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
     * {@code users.nickname} 은 보지 않는다 (V9, apps/api/CONTRACT.md §5-1).
     *
     * <p>{@code INSERT … SELECT FROM users} 인 것은 없는 사용자를 FK 위반이 아니라 <b>0행</b>으로
     * 돌려받기 위해서다. 그래야 "없으면 {@code null}" 이 그대로 성립한다. 방향은 같은 트랜잭션에서
     * 통째로 갈아 끼운다 — 부분 저장은 없다.
     */
    @Override
    public Account saveProfile(UUID userId, Profile profile, String signupClient) {
        return transaction.execute(status -> {
            if (!lockActive(userId)) {
                return null;
            }
            int saved = entityManager.createNativeQuery("""
                    INSERT INTO user_profiles(user_id,name,gender,birth_date,experience,goal,bio,signup_client)
                    SELECT id,:name,:gender,:birthDate,:experience,:goal,CAST(:bio AS text),CAST(:signupClient AS text)
                    FROM users
                    WHERE id=:userId
                    ON CONFLICT (user_id) DO UPDATE
                    SET name=EXCLUDED.name,gender=EXCLUDED.gender,birth_date=EXCLUDED.birth_date,
                        experience=EXCLUDED.experience,goal=EXCLUDED.goal,bio=EXCLUDED.bio,
                        signup_client=COALESCE(user_profiles.signup_client,EXCLUDED.signup_client),
                        updated_at=now()
                    """)
                    .setParameter("name", profile.name())
                    .setParameter("gender", profile.gender())
                    .setParameter("birthDate", Date.valueOf(profile.birthDate()))
                    .setParameter("experience", profile.experience())
                    .setParameter("goal", profile.goal())
                    // 소개는 비어 있을 수 있다. SELECT 목록의 NULL 파라미터는 타입을 추론하지 못해 CAST 한다.
                    .setParameter("bio", profile.bio())
                    // 가입한 판은 처음 한 번만 남는다(COALESCE). 같은 이유로 NULL 파라미터는 CAST 한다.
                    .setParameter("signupClient", signupClient)
                    .setParameter("userId", userId)
                    .executeUpdate();
            if (saved == 0) {
                return null;
            }
            entityManager.createQuery("delete from UserProfileDirectionEntity d where d.userId = :userId")
                    .setParameter("userId", userId)
                    .executeUpdate();
            for (String direction : profile.directions()) {
                entityManager.createQuery("""
                                insert into UserProfileDirectionEntity (id, userId, direction)
                                values (:id, :userId, :direction)
                                """)
                        .setParameter("id", UUID.randomUUID())
                        .setParameter("userId", userId)
                        .setParameter("direction", ActingDirection.valueOf(direction.toUpperCase(Locale.ROOT)))
                        .executeUpdate();
            }
            return find(userId);
        });
    }

    @Override
    public List<UUID> idleGuests(Instant lastActiveBefore) {
        return list(entityManager.createNativeQuery("""
                SELECT users.id
                FROM users
                WHERE users.status='active'
                  AND EXISTS (SELECT 1 FROM user_identities
                              WHERE user_identities.user_id=users.id)
                  AND NOT EXISTS (SELECT 1 FROM user_identities
                                  WHERE user_identities.user_id=users.id
                                    AND user_identities.provider<>'guest')
                  AND GREATEST(
                        users.created_at,
                        COALESCE((SELECT max(issued_at) FROM refresh_tokens
                                  WHERE refresh_tokens.user_id=users.id),users.created_at),
                        COALESCE((SELECT max(created_at) FROM upload_intents
                                  WHERE upload_intents.user_id=users.id),users.created_at),
                        COALESCE((SELECT max(created_at) FROM practice_sessions
                                  WHERE practice_sessions.user_id=users.id),users.created_at),
                        COALESCE((SELECT max(created_at) FROM scripts
                                  WHERE scripts.user_id=users.id),users.created_at),
                        COALESCE((SELECT max(updated_at) FROM reading_sessions
                                  WHERE reading_sessions.user_id=users.id),users.created_at),
                        COALESCE((SELECT max(updated_at) FROM reading_recordings
                                  WHERE reading_recordings.user_id=users.id),users.created_at),
                        COALESCE((SELECT max(updated_at) FROM line_memorization
                                  WHERE line_memorization.user_id=users.id),users.created_at)) < :cutoff
                ORDER BY users.created_at,users.id
                """, Tuple.class)
                .setParameter("cutoff", lastActiveBefore.atOffset(ZoneOffset.UTC))).stream()
                .map(row -> row.get("id", UUID.class))
                .toList();
    }

    /**
     * 탈퇴 3년 뒤의 파기. 해시 행을 지우는 것과 영상·녹음 삭제를 장부에 올리는 것이 한 트랜잭션이어야 "해시는 지워졌는데 영상은
     * 남은" 계정이 생기지 않는다. 해시 보관 기간이 곧 영상 보관 기간이다(ADR-029). 여기서 트랜잭션을 열고, 표를 고치고 객체
     * 삭제를 장부에 올리는 것은 주인({@link RetentionPurge}, {@link VideoRetention}, {@link EntryMediaPurge},
     * {@link RetainedRecordings})이 한다.
     */
    @Override
    public List<UUID> purgeRetained(Instant deactivatedBefore, Instant now) {
        return transaction.execute(status -> {
            List<UUID> expired = retentionPurge.lockExpired(deactivatedBefore);
            List<UUID> cleanups = new ArrayList<>();
            for (UUID userId : expired) {
                // 보관 동의로 남겨 두었던 영상도 이제 파일이 없다 — 행과 최소 메타만 남긴다.
                cleanups.addAll(retainedVideos.purgeFilesOf(userId, now));
                cleanups.addAll(retainedEntryMedia.purgeOf(userId, now));
                // 보관 동의로 남겨 두었던 리딩 녹음(음성과 전사)은 행째 지우고 객체는 장부로 간다(specs/reading).
                cleanups.addAll(retainedRecordings.purgeOf(userId, now));
                retentionPurge.complete(userId, now);
            }
            return List.copyOf(cleanups);
        });
    }

    @Override
    public int deleteExpiredWebAttributions(Instant before) {
        return transaction.execute(status -> entityManager.createQuery("""
                        delete from UserSignupAttributionEntity a
                        where a.source = 'web_utm'
                          and a.recordedAt < :before
                        """)
                .setParameter("before", before)
                .executeUpdate());
    }

    @Override
    public NotificationSettings notificationSettings(UUID userId) {
        List<Tuple> rows = entityManager.createQuery("""
                        select p.notifyAnalysisDone as notify_analysis_done, p.notifyChallenge as notify_challenge,
                               p.notifyEveningReminder as notify_evening_reminder
                        from UserProfileEntity p
                        where p.userId = :userId
                        """, Tuple.class)
                .setParameter("userId", userId)
                .getResultList();
        return rows.isEmpty() ? null : settings(rows.getFirst());
    }

    /**
     * 처음 온 값만 남긴다 — {@code ON CONFLICT DO NOTHING}. 탈퇴와 겹치면 같은 {@code users} 행을 잡고
     * 활성인지 본다({@link #lockActive}): 탈퇴가 먼저면 쓰지 않는다. 탈퇴는 이 표의 행을 지우므로, 확인 없이 쓰면
     * 파기한 유입 기록이 다시 생긴다.
     */
    @Override
    public boolean recordSignupAttribution(UUID userId, SignupAttribution attribution, String recordedVia) {
        return Boolean.TRUE.equals(transaction.execute(status -> {
            if (!lockActive(userId)) {
                return false;
            }
            entityManager.createQuery("""
                            insert into UserSignupAttributionEntity
                                (userId, source, platform, channel, medium, campaign, adGroup, adCreative, content, term,
                                 subPublisher, recordedVia)
                            values
                                (:userId, :source, :platform, :channel, :medium, :campaign, :adGroup, :adCreative, :content,
                                 :term, :subPublisher, :recordedVia)
                            on conflict (userId) do nothing
                            """)
                    .setParameter("userId", userId)
                    .setParameter("source", attribution.source())
                    .setParameter("platform", attribution.platform())
                    .setParameter("channel", attribution.channel())
                    .setParameter("medium", attribution.medium())
                    .setParameter("campaign", attribution.campaign())
                    .setParameter("adGroup", attribution.adGroup())
                    .setParameter("adCreative", attribution.adCreative())
                    .setParameter("content", attribution.content())
                    .setParameter("term", attribution.term())
                    .setParameter("subPublisher", attribution.subPublisher())
                    .setParameter("recordedVia", recordedVia)
                    .executeUpdate();
            return true;
        }));
    }

    /**
     * 유입 기록이 아직 없을 때만, 계정마다 한 줄만 둔다(V43). 활성 계정을 먼저 잡는 이유는 유입 기록과 같다 — 탈퇴가 이 표의
     * 줄을 지우므로 확인 없이 쓰면 파기한 기기 ID 가 되살아난다.
     */
    @Override
    public boolean recordAirbridgeDevice(UUID userId, String platform, String deviceUuid) {
        return Boolean.TRUE.equals(transaction.execute(status -> {
            if (!lockActive(userId)) {
                return false;
            }
            entityManager.createQuery("""
                            insert into UserAirbridgeDeviceLookupEntity (userId, platform, deviceUuid)
                            select :userId, :platform, :deviceUuid
                            where not exists (select 1 from UserSignupAttributionEntity a where a.userId = :userId)
                            on conflict do nothing
                            """)
                    .setParameter("userId", userId)
                    .setParameter("platform", platform)
                    .setParameter("deviceUuid", deviceUuid)
                    .executeUpdate();
            return true;
        }));
    }

    /**
     * 처음 답만 남긴다 — {@code ON CONFLICT DO NOTHING}. 유입 광고 기록과 같은 이유로 활성 계정을 먼저 잡는다
     * ({@link #lockActive}): 탈퇴가 먼저면 쓰지 않는다. 탈퇴는 이 표의 행을 지운다.
     */
    @Override
    public boolean recordDiscoveryAnswer(UUID userId, DiscoveryAnswer answer) {
        return Boolean.TRUE.equals(transaction.execute(status -> {
            if (!lockActive(userId)) {
                return false;
            }
            entityManager.createQuery("""
                            insert into UserDiscoveryAnswerEntity (userId, source, detail, otherText)
                            values (:userId, :source, :detail, :otherText)
                            on conflict (userId) do nothing
                            """)
                    .setParameter("userId", userId)
                    .setParameter("source", answer.source())
                    .setParameter("detail", answer.detail())
                    .setParameter("otherText", answer.otherText())
                    .executeUpdate();
            return true;
        }));
    }

    /**
     * 이관으로 닫힐 게스트의 유입 기록을 지운다. 회원이 게스트 뒤에 새로 가입한 계정인지 증명할 신호가 없으므로
     * 회원에게 옮기지 않는다. 기존 회원의 과거 가입 출처를 웹 재방문의 UTM으로 오염시키지 않는 쪽이 안전하다.
     */
    @Override
    public void discardTransferredGuest(UUID guestId) {
        entityManager.createQuery("delete from UserSignupAttributionEntity a where a.userId = :guestId")
                .setParameter("guestId", guestId)
                .executeUpdate();
        entityManager.createQuery("delete from UserAirbridgeDeviceLookupEntity l where l.userId = :guestId")
                .setParameter("guestId", guestId)
                .executeUpdate();
    }

    /** 가입 직후 답한 유입 경로도 회원에게 옮기지 않는다. */
    @Override
    public void discardTransferredGuestAnswer(UUID guestId) {
        entityManager.createQuery("delete from UserDiscoveryAnswerEntity a where a.userId = :guestId")
                .setParameter("guestId", guestId)
                .executeUpdate();
    }

    /**
     * "셋 다 꺼짐"과 "토큰 없음"이 한 트랜잭션이어야 한다 — 나누면 꺼 놓고도 알림이 오는 틈이 생긴다. 토큰은 주인({@code push})이
     * 이 트랜잭션 안에서 지운다.
     */
    @Override
    public NotificationSettings updateNotificationSettings(
            UUID userId, Boolean analysisDone, Boolean challenge, Boolean eveningReminder) {
        return transaction.execute(status -> {
            if (!lockActive(userId)) {
                return null;
            }
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
                pushTokens.revokeAllOf(userId);
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

    /**
     * 앞의 올리기가 남긴 키를 <b>같은 문장에서</b> 돌려받아 장부에 올린다. 그냥 덮으면 올리다 만 객체의 키를
     * 아는 곳이 없어져 탈퇴도 그 객체를 지우지 못한다. 그 주소는 시한까지 살아 있으므로 삭제는 시한 뒤로
     * 미룬다 — 먼저 지우면 그 뒤에 올라온 객체가 다시 남는다.
     */
    @Override
    public boolean beginPhotoUpload(UUID userId, PhotoUpload upload, Instant now) {
        return Boolean.TRUE.equals(transaction.execute(status -> {
            if (!lockActive(userId)) {
                return false;
            }
            List<Tuple> rows = list(entityManager.createNativeQuery("""
                    WITH before AS (
                        SELECT user_id,photo_upload_key,photo_upload_expires_at
                        FROM user_profiles
                        WHERE user_id=:userId
                        FOR UPDATE
                    ), changed AS (
                        UPDATE user_profiles
                        SET photo_upload_key=:objectKey,photo_upload_mime_type=:mimeType,
                            photo_upload_size_bytes=:sizeBytes,photo_upload_expires_at=:expiresAt,
                            updated_at=now()
                        FROM before
                        WHERE user_profiles.user_id=before.user_id
                        RETURNING before.photo_upload_key AS abandoned,
                                  before.photo_upload_expires_at AS abandoned_expires_at
                    )
                    SELECT abandoned,abandoned_expires_at FROM changed
                    """, Tuple.class)
                    .setParameter("objectKey", upload.objectKey())
                    .setParameter("mimeType", upload.mimeType())
                    .setParameter("sizeBytes", upload.sizeBytes())
                    .setParameter("expiresAt", upload.expiresAt().atOffset(ZoneOffset.UTC))
                    .setParameter("userId", userId));
            if (rows.isEmpty()) {
                return false;
            }
            String abandoned = rows.getFirst().get("abandoned", String.class);
            if (abandoned != null) {
                Instant abandonedExpiresAt = rows.getFirst().get("abandoned_expires_at", Instant.class);
                cleanups.schedule(userId, List.of(abandoned), now, abandonedExpiresAt == null ? now : abandonedExpiresAt);
            }
            return true;
        }));
    }

    @Override
    public PhotoUpload pendingPhotoUpload(UUID userId) {
        List<Tuple> rows = entityManager.createQuery("""
                        select p.photoUploadKey as photo_upload_key, p.photoUploadMimeType as photo_upload_mime_type,
                               p.photoUploadSizeBytes as photo_upload_size_bytes,
                               p.photoUploadExpiresAt as photo_upload_expires_at
                        from UserProfileEntity p
                        where p.userId = :userId
                          and p.photoUploadKey is not null
                        """, Tuple.class)
                .setParameter("userId", userId)
                .getResultList();
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
     * 사진을 두 번 지우려 한다 (apps/api/CONTRACT.md §5-2). 옛 객체의 삭제는 같은 트랜잭션에서 장부에 올린다 —
     * 커밋 뒤에 저장소가 실패해도 키를 잃지 않는다.
     */
    @Override
    public List<UUID> completePhotoUpload(UUID userId, String objectKey, Instant now) {
        return transaction.execute(status -> lockActive(userId)
                ? scheduleReplaced(userId, now, entityManager.createNativeQuery("""
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
                        .setParameter("objectKey", objectKey))
                : null);
    }

    @Override
    public List<UUID> clearPhoto(UUID userId, Instant now) {
        return transaction.execute(status -> lockActive(userId)
                ? scheduleReplaced(userId, now, entityManager.createNativeQuery("""
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
                        .setParameter("userId", userId))
                : null);
    }

    /** 쓰이던 사진은 올리기 주소가 이미 끝난 객체라 바로 지워도 된다. */
    private List<UUID> scheduleReplaced(UUID userId, Instant now, jakarta.persistence.Query query) {
        List<Tuple> rows = list(query);
        String replaced = rows.isEmpty() ? null : rows.getFirst().get("replaced", String.class);
        return replaced == null ? List.of() : List.of(cleanups.schedule(userId, List.of(replaced), now, now));
    }

    /**
     * 탈퇴 트랜잭션 (account.withdraw, ADR-029).
     *
     * <p>행을 지우지 않는다 — 연습 기록과 남의 화면에 얽힌 행이 {@code user_id} 를 참조하므로 지우면
     * 남의 흐름이 깨진다. 대신 바로 알아보게 하는 것을 파기하고, 나머지는 사람과 끊어 남긴다.
     * <b>상태 전환과 파기가 한 트랜잭션이다</b> — 나누면 중간 실패 시 "탈퇴했는데 refresh 는 살아
     * 있는" 계정이 남는다. 여기서 트랜잭션을 열고, 순서는 {@link AccountErasureSequence#close} 가 정한다.
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
     * <p>표는 각 주인이 {@code AccountErasure} 를 구현해 고친다(ADR-040). 이 저장소는 남의 표를 모른다.
     *
     * <p>이미 탈퇴한 계정이면 <b>최초 탈퇴 시각을 유지</b>한다. 파기는 멱등하게 다시 돈다.
     */
    @Override
    public Withdrawn withdraw(UUID userId, Instant now, LocalDate today) {
        return transaction.execute(status -> {
            AccountErasureSequence.Closed closed = closing.close(userId, now, today);
            return closed == null ? null : new Withdrawn(closed.deactivatedAt(), closed.cleanupOperationIds());
        });
    }

    /** 만 14세 미만 계정 닫기. 여기서 트랜잭션을 열고, 순서는 {@link AccountErasureSequence#closeUnderage} 가 정한다. */
    @Override
    public List<UUID> closeUnderage(UUID userId, Instant now, LocalDate today) {
        return transaction.execute(status -> closing.closeUnderage(userId, now, today));
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
