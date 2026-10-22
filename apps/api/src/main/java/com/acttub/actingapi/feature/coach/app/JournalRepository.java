package com.acttub.actingapi.feature.coach.app;

import java.time.Instant;
import java.util.UUID;

/**
 * 배우 일지의 저장소(practice.journal, {@code actor_journals}). 회차마다 한 줄이고 본인 것만 읽고 고친다.
 * 배우의 답({@code answers})과 자동 칸({@code draft})은 JSON 글로 따로 둔다.
 */
public interface JournalRepository {

    /** @return 없거나 남의 것이면 {@code null} */
    Row find(UUID userId, UUID practiceId);

    /**
     * 만드는 중(pending) 줄을 먼저 넣는다. 같은 회차에 이미 있으면 넣지 않고 {@code false} — 겹친 요청이 모델을 두 번 부르지 않는다.
     */
    boolean insertPending(UUID id, UUID userId, UUID practiceId, UUID conversationId, String answers, Instant now);

    /**
     * 자동 칸 생성의 끝. 아직 만드는 중이고 배우가 고치지 않았을 때만 쓴다 — 늦게 끝난 생성이 고친 일지를 덮지 않는다.
     *
     * @param status ready·failed·skipped
     */
    void complete(UUID id, String status, String draft, String model, Instant now);

    /**
     * 배우가 고친 일지를 저장한다. 만드는 중이던 줄은 고친 값으로 ready 가 된다.
     *
     * @return 없거나 남의 것이면 {@code null}
     */
    Row update(UUID userId, UUID practiceId, String answers, String draft, Instant now);

    /**
     * @param title 회차(없으면 첫 회차)의 장면 제목. 없으면 null
     * @param purpose 코칭 목적(evaluate·stuck·character·concern). 목적 없이 한 코칭은 null
     * @param roleName 배역 이름. 모르면 null
     */
    record Row(
            UUID id,
            UUID practiceId,
            UUID conversationId,
            String answers,
            String draft,
            String draftStatus,
            String model,
            Instant editedAt,
            Instant createdAt,
            Instant updatedAt,
            String title,
            String purpose,
            String roleName) {
    }
}
