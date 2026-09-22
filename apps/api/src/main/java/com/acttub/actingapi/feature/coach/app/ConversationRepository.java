package com.acttub.actingapi.feature.coach.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 1.0.0 회차의 코치 대화 저장소 — {@code coach_conversations}·{@code coach_messages}·{@code coach_notes} (practice.coach,
 * practice.note). 옛 {@link CoachSessionRepository}(={@code coach_sessions} + {@code coach_turns})와 다른 포트다.
 *
 * <p><b>회차에 대화는 하나다.</b> 열린 대화는 같은 id 로 재개하고, 닫힌 뒤 다시 코칭하려면 새 회차다(practice.resume).
 *
 * <p>멱등은 두 자리다: 시작은 {@code start_request_id}, 배우 메시지는 {@code (conversation_id, request_id)} 다. 같은
 * 요청 id 에 다른 본문이면 422 {@code request_fingerprint_mismatch} 라 지문을 함께 둔다.
 *
 * <p><b>바깥 호출(LLM)은 트랜잭션 밖이다</b>(CONTRACT §5-4). 저장할 때 {@code state_revision} 이 읽은 값과 다르면
 * 아무것도 쓰지 않고 409 {@code conversation_conflict} 다 — 화면은 입력을 보존한 채 최신 대화를 다시 읽는다.
 */
public interface ConversationRepository {

    /**
     * 회차의 대화를 엔진이 쓰는 모양으로 읽는다. 대화가 아직 없으면 {@code conversationId} 가 {@code null} 이고
     * 스냅샷은 빈 대화다.
     *
     * @return 회차가 없거나 남의 것이면 {@code null}
     */
    Loaded loadByPractice(UUID userId, UUID practiceId);

    /** 대화 id 로 읽는다. 없거나 남의 것이면 {@code null}. */
    Loaded loadByConversation(UUID userId, UUID conversationId);

    /**
     * @param stage 회차의 진행. 코치는 {@code conversing} 에서만 시작한다
     * @param startRequestId 대화를 연 요청. 같은 id 의 재전송이면 같은 대화다
     */
    record Loaded(
            UUID practiceId,
            UUID conversationId,
            UUID startRequestId,
            String stage,
            CoachSessionSnapshot session) {
    }

    /**
     * 대화를 연다 — 회차당 하나다. 그 사이에 다른 요청이 먼저 열었으면 그 대화의 id 를 돌려준다.
     */
    UUID open(UUID practiceId, UUID startRequestId, Instant now);

    /**
     * 시작 응답(코치의 첫 말)을 저장한다. 같은 대화에 이미 턴이 있으면 아무것도 쓰지 않는다 — 시작 재전송이
     * 턴을 늘리지 않는다.
     */
    void saveOpening(UUID conversationId, String coachMessage, JsonNode state, Instant now);

    /**
     * 같은 요청 id 가 이미 만든 턴. 지문이 다르면 {@link Replay#mismatch()} 가 참이다.
     *
     * @return 그런 요청이 없으면 {@code null}
     */
    Replay findReplay(UUID conversationId, UUID requestId, String fingerprint);

    /** @param coachMessage 그 요청이 만든 코치 응답. 지문이 어긋나면 {@code null} */
    record Replay(boolean mismatch, String coachMessage, String status, String closeReason, long revision, int turnCount) {
    }

    /**
     * 배우 메시지와 코치 응답을 한 턴으로 저장하고 상태를 갈아 끼운다.
     *
     * @param expectedRevision 엔진을 부르기 전에 읽은 값. 저장 시점에 다르면 아무것도 쓰지 않는다
     * @return 충돌이면 {@code null}
     */
    Saved appendTurn(
            UUID conversationId,
            long expectedRevision,
            UUID requestId,
            String fingerprint,
            String actorText,
            String coachMessage,
            JsonNode state,
            String status,
            String closeReason,
            Instant now);

    record Saved(long revision, String status, String closeReason, int coachReplyCount) {
    }

    /**
     * 저장 직전에 본 계정이 활성이 아니다 — 바깥 호출이 도는 사이에 다른 기기의 탈퇴가 끝났다
     * (practice.coach "대화 중 탈퇴: 그 뒤 도착한 코치 응답이 저장되지 않는다").
     *
     * <p>무엇을 응답할지는 부르는 자리가 정한다(ADR-018). 예외인 것은 <b>정상 갈래와 갈라야 하기</b>
     * 때문이다 — {@code null} 은 이미 "동시 저장이 이겼다"(409)라는 뜻을 갖고 있다.
     */
    class OwnerNotActive extends RuntimeException {
        public OwnerNotActive() {
            super("conversation owner is not active");
        }
    }

    /**
     * 노트를 한 번 만든다. 이미 있으면 그것을 돌려주고 새로 쓰지 않는다 — 재생성 요청이 같은 노트를 준다.
     */
    NoteView saveNote(UUID conversationId, NewNote note, Instant now);

    /**
     * @param title 초점 문구 원문. 초점 없이 끝난 {@code record_only} 는 {@code null}
     * @param legacyReport 기존 갈래의 원문. 신형이면 {@code null}
     */
    record NewNote(
            String format,
            String kind,
            String title,
            JsonNode summaryQuotes,
            String nextTake,
            JsonNode actorWords,
            JsonNode corrections,
            JsonNode tags,
            boolean fallback,
            long sourceRevision,
            JsonNode legacyReport) {
    }

    /** 노트 하나. 없으면 {@code null}. */
    NoteView note(UUID userId, UUID practiceId);

    record NoteView(
            UUID id,
            UUID conversationId,
            String format,
            String kind,
            String title,
            JsonNode summaryQuotes,
            String nextTake,
            JsonNode actorWords,
            JsonNode corrections,
            JsonNode tags,
            boolean fallback,
            long sourceRevision,
            JsonNode legacyReport,
            Instant createdAt) {
    }

    /** 대화 하나를 턴과 함께 읽는다(화면의 복귀·이전 대화 보기). 없거나 남의 것이면 {@code null}. */
    ConversationView conversation(UUID userId, UUID conversationId);

    record ConversationView(
            UUID id,
            UUID practiceId,
            String status,
            String closeReason,
            String experienceVersion,
            long revision,
            Instant createdAt,
            List<Turn> turns) {
    }

    /** @param role {@code actor}·{@code coach}(저장은 옛 값과 같은 {@code ai} 다) */
    record Turn(int turnIndex, String role, String text, Instant createdAt) {
    }
}
