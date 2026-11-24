package com.acttub.jpqlprobe;

import java.io.Serializable;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import tools.jackson.databind.JsonNode;

/**
 * JPQL·HQL 실험(SOMA-1112)에 쓰는 매핑. 운영 Schema Entity 와 따로 둔다.
 *
 * <p>운영 엔티티는 기능 패키지 안에 package-private 로 있고, 매핑이 없는 표(은퇴·대기 목록)도 실험해야 해서 실험 쪽에
 * 필요한 열만 매핑한 엔티티를 만든다. 열 이름과 형은 Flyway 스키마와 같다. 패키지가 {@code com.acttub.actingapi}
 * 밖이라 앱의 엔티티 스캔과 구조 테스트에 들어가지 않는다.
 */
final class ProbeEntities {
    private ProbeEntities() {
    }

    @Entity(name = "ProbeUser")
    @Table(name = "users")
    static class ProbeUser {
        @Id
        UUID id;
        String email;
        String status;
        @Column(name = "deactivated_at")
        Instant deactivatedAt;
        @Column(name = "retention_purged_at")
        Instant retentionPurgedAt;
        @Column(name = "created_at")
        Instant createdAt;
    }

    static class DayKey implements Serializable {
        UUID userId;
        LocalDate day;

        @Override
        public boolean equals(Object other) {
            return other instanceof DayKey key && Objects.equals(userId, key.userId) && Objects.equals(day, key.day);
        }

        @Override
        public int hashCode() {
            return Objects.hash(userId, day);
        }
    }

    @Entity(name = "ProbeUserActiveDay")
    @Table(name = "user_active_days")
    @IdClass(DayKey.class)
    static class ProbeUserActiveDay {
        @Id
        @Column(name = "user_id")
        UUID userId;
        @Id
        LocalDate day;
    }

    @Entity(name = "ProbePortfolio")
    @Table(name = "portfolios")
    static class ProbePortfolio {
        @Id
        @Column(name = "user_id")
        UUID userId;
        String intro;
    }

    @Entity(name = "ProbeAdSettings")
    @Table(name = "ad_settings")
    static class ProbeAdSettings {
        @Id
        Integer id;
        @Column(name = "window_minutes")
        int windowMinutes;
        @Column(name = "window_cap")
        int windowCap;
        @Column(name = "first_day_cap")
        int firstDayCap;
        @Column(name = "updated_at")
        Instant updatedAt;
    }

    @Entity(name = "ProbePushToken")
    @Table(name = "push_tokens")
    static class ProbePushToken {
        @Id
        UUID id;
        @Column(name = "user_id")
        UUID userId;
        String token;
        String platform;
        String locale;
        @Column(name = "app_version")
        String appVersion;
        @Column(name = "updated_at")
        Instant updatedAt;
    }

    @Entity(name = "ProbeUserProfile")
    @Table(name = "user_profiles")
    static class ProbeUserProfile {
        @Id
        @Column(name = "user_id")
        UUID userId;
        @Column(name = "notify_analysis_done")
        boolean notifyAnalysisDone;
        @Column(name = "notify_challenge")
        boolean notifyChallenge;
        @Column(name = "notify_evening_reminder")
        boolean notifyEveningReminder;
    }

    @Entity(name = "ProbeReadingRecording")
    @Table(name = "reading_recordings")
    static class ProbeReadingRecording {
        @Id
        UUID id;
        @Column(name = "line_id")
        UUID lineId;
        @Column(name = "user_id")
        UUID userId;
        @Column(name = "object_key")
        String objectKey;
    }

    @Entity(name = "ProbeCoachConversation")
    @Table(name = "coach_conversations")
    static class ProbeCoachConversation {
        @Id
        UUID id;
        @Column(name = "practice_id")
        UUID practiceId;
        @JdbcTypeCode(SqlTypes.JSON)
        JsonNode state;
        @Column(name = "state_revision")
        int stateRevision;
        String status;
        @Column(name = "closed_at")
        Instant closedAt;
    }

    @Entity(name = "ProbePractice")
    @Table(name = "practices")
    static class ProbePractice {
        @Id
        UUID id;
        @Column(name = "user_id")
        UUID userId;
        @Column(name = "root_id")
        UUID rootId;
        @Column(name = "created_at")
        Instant createdAt;
    }

    @Entity(name = "ProbeUploadIntent")
    @Table(name = "upload_intents")
    static class ProbeUploadIntent {
        @Id
        UUID id;
        @Column(name = "user_id")
        UUID userId;
        @Column(name = "object_key")
        String objectKey;
        String status;
        @Column(name = "expires_at")
        Instant expiresAt;
    }

    @Entity(name = "ProbeAiJob")
    @Table(name = "ai_jobs")
    static class ProbeAiJob {
        @Id
        UUID id;
        String kind;
        String status;
        @Column(name = "lease_expires_at")
        Instant leaseExpiresAt;
        @Column(name = "lease_token")
        UUID leaseToken;
        @Column(name = "attempt_count")
        int attemptCount;
        @Column(name = "created_at")
        Instant createdAt;
        @Column(name = "updated_at")
        Instant updatedAt;
        @Column(name = "user_id")
        UUID userId;
        @Column(name = "target_id")
        UUID targetId;
        @Column(name = "memory_epoch")
        Integer memoryEpoch;
    }

    @Entity(name = "ProbeConsentDocument")
    @Table(name = "consent_documents")
    static class ProbeConsentDocument {
        @Id
        UUID id;
        String type;
        String locale;
        String version;
        @Column(name = "published_at")
        Instant publishedAt;
    }

    @Entity(name = "ProbeUserConsent")
    @Table(name = "user_consents")
    static class ProbeUserConsent {
        @Id
        UUID id;
        @Column(name = "user_id")
        UUID userId;
        @Column(name = "document_id")
        UUID documentId;
        String action;
        @Column(name = "occurred_at")
        Instant occurredAt;
    }

    @Entity(name = "ProbeAdEvent")
    @Table(name = "ad_events")
    static class ProbeAdEvent {
        @Id
        UUID id;
        @Column(name = "ad_id")
        UUID adId;
        LocalDate day;
        String event;
        String slot;
        @Column(name = "user_id")
        UUID userId;
    }

    @Entity(name = "ProbeEntry")
    @Table(name = "challenge_entries")
    static class ProbeEntry {
        @Id
        UUID id;
        @Column(name = "challenge_id")
        UUID challengeId;
        @Column(name = "user_id")
        UUID userId;
        @Column(name = "final_rank")
        Integer finalRank;
        @Column(name = "final_like_count")
        Long finalLikeCount;
        @Column(name = "final_eligible")
        Boolean finalEligible;
        String status;
        @Column(name = "mosaic_key")
        String mosaicKey;
        @Column(name = "updated_at")
        Instant updatedAt;
    }

    @Entity(name = "ProbeEntryLike")
    @Table(name = "entry_likes")
    static class ProbeEntryLike {
        @Id
        UUID id;
        @Column(name = "entry_id")
        UUID entryId;
        @Column(name = "user_id")
        UUID userId;
    }

    @Entity(name = "ProbeCommunityPost")
    @Table(name = "community_posts")
    static class ProbeCommunityPost {
        @Id
        UUID id;
        @Column(name = "comment_count")
        int commentCount;
        @Column(name = "like_count")
        int likeCount;
    }

    @Entity(name = "ProbePostLike")
    @Table(name = "community_post_likes")
    static class ProbePostLike {
        @Id
        UUID id;
        @Column(name = "post_id")
        UUID postId;
        @Column(name = "user_id")
        UUID userId;
    }

    @Entity(name = "ProbeAlias")
    @Table(name = "community_anonymous_aliases")
    static class ProbeAlias {
        @Id
        UUID id;
        @Column(name = "post_id")
        UUID postId;
        @Column(name = "user_id")
        UUID userId;
        int ordinal;
    }

    @Entity(name = "ProbeLineMemorization")
    @Table(name = "line_memorization")
    static class ProbeLineMemorization {
        @Id
        UUID id;
        @Column(name = "line_id")
        UUID lineId;
    }

    @Entity(name = "ProbeScriptLine")
    @Table(name = "script_lines")
    static class ProbeScriptLine {
        @Id
        UUID id;
        @Column(name = "script_id")
        UUID scriptId;
    }

    @Entity(name = "ProbeScriptUpload")
    @Table(name = "script_uploads")
    static class ProbeScriptUpload {
        @Id
        UUID id;
        @Column(name = "script_id")
        UUID scriptId;
        @Column(name = "raw_text")
        String rawText;
        @Column(name = "updated_at")
        Instant updatedAt;
    }

    @Entity(name = "ProbeScriptImport")
    @Table(name = "script_imports")
    static class ProbeScriptImport {
        @Id
        UUID id;
        @Column(name = "upload_id")
        UUID uploadId;
    }

    @Entity(name = "ProbeReadingSession")
    @Table(name = "reading_sessions")
    static class ProbeReadingSession {
        @Id
        UUID id;
        @Column(name = "user_id")
        UUID userId;
        @Column(name = "script_id")
        UUID scriptId;
        @Column(name = "my_character_ids")
        UUID[] myCharacterIds;
        @JdbcTypeCode(SqlTypes.JSON)
        @Column(name = "line_results")
        JsonNode lineResults;
        @JdbcTypeCode(SqlTypes.JSON)
        @Column(name = "line_said")
        JsonNode lineSaid;
        @Column(name = "started_at")
        Instant startedAt;
        String status;
    }

    @Entity(name = "ProbeScriptCharacter")
    @Table(name = "script_characters")
    static class ProbeScriptCharacter {
        @Id
        UUID id;
        @Column(name = "script_id")
        UUID scriptId;
        @Column(name = "member_ids")
        UUID[] memberIds;
    }

    @Entity(name = "ProbePostImage")
    @Table(name = "community_post_images")
    static class ProbePostImage {
        @Id
        UUID id;
        @Column(name = "post_id")
        UUID postId;
        @Column(name = "object_key")
        String objectKey;
        @Column(name = "sort_order")
        Integer sortOrder;
    }

    static class SendKey implements Serializable {
        UUID userId;
        LocalDate day;
        String slot;

        @Override
        public boolean equals(Object other) {
            return other instanceof SendKey key && Objects.equals(userId, key.userId) && Objects.equals(day, key.day)
                    && Objects.equals(slot, key.slot);
        }

        @Override
        public int hashCode() {
            return Objects.hash(userId, day, slot);
        }
    }

    @Entity(name = "ProbeReminderSend")
    @Table(name = "practice_reminder_sends")
    @IdClass(SendKey.class)
    static class ProbeReminderSend {
        @Id
        @Column(name = "user_id")
        UUID userId;
        @Id
        LocalDate day;
        @Id
        String slot;
        @Column(name = "template_id")
        String templateId;
    }

    @Entity(name = "ProbeProfileDirection")
    @Table(name = "user_profile_directions")
    static class ProbeProfileDirection {
        @Id
        UUID id;
        @Column(name = "user_id")
        UUID userId;
        String direction;
    }

    @Entity(name = "ProbeVideo")
    @Table(name = "videos")
    static class ProbeVideo {
        @Id
        UUID id;
        @Column(name = "user_id")
        UUID userId;
        @Column(name = "object_key")
        String objectKey;
        @Column(name = "poster_key")
        String posterKey;
        @Column(name = "purged_at")
        Instant purgedAt;
    }

    @Entity(name = "ProbeActorMemory")
    @Table(name = "actor_memories")
    static class ProbeActorMemory {
        @Id
        UUID id;
        @Column(name = "user_id")
        UUID userId;
        String field;
        String value;
        @Column(name = "written_by")
        String writtenBy;
        @Column(name = "scene_root_id")
        UUID sceneRootId;
    }

    @Entity(name = "ProbeCoachNote")
    @Table(name = "coach_notes")
    static class ProbeCoachNote {
        @Id
        UUID id;
        @Column(name = "conversation_id")
        UUID conversationId;
        @JdbcTypeCode(SqlTypes.JSON)
        @Column(name = "line_notes")
        JsonNode lineNotes;
    }

    @Entity(name = "ProbeRetranscript")
    @Table(name = "reading_recording_retranscripts")
    static class ProbeRetranscript {
        @Id
        @Column(name = "recording_id")
        UUID recordingId;
        String status;
        @Column(name = "attempt_count")
        int attemptCount;
        @Column(name = "lease_token")
        UUID leaseToken;
        @Column(name = "lease_until")
        Instant leaseUntil;
        @Column(name = "updated_at")
        Instant updatedAt;
    }

    @Entity(name = "ProbePracticeSession")
    @Table(name = "practice_sessions")
    static class ProbePracticeSession {
        @Id
        UUID id;
        @Column(name = "continued_from")
        UUID continuedFrom;
    }
}
