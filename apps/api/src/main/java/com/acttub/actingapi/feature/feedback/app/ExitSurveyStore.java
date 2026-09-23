package com.acttub.actingapi.feature.feedback.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 이탈 설문의 저장소 — {@code practice_feedback} 와 {@code users.exit_survey_asked_at} (practice.feedback, V14).
 *
 * <p><b>DB 가 정본이고 시트는 복제본이다</b>(ERD). 접수는 DB 커밋으로 끝나고, 시트 전송은 뒤에서 같은 설문
 * id 와 변경 순번({@code sheet_seq})으로 보낸다 — 실패하면 {@code sheet_synced_at} 이 NULL 로 남아 매일 도는
 * 일이 다시 보낸다.
 */
public interface ExitSurveyStore {

    /** 그 회차가 이 사람의 것인가. {@code practiceId} 가 {@code null} 이면 참 — 회차 없이도 보낼 수 있다. */
    boolean ownsPractice(UUID userId, UUID practiceId);

    /**
     * 설문 한 건을 접수한다. 같은 {@code requestId} 의 재전송은 <b>행을 늘리지 않고</b> 먼저 만든 것을
     * 돌려준다 — 오프라인에서 들고 있다 다시 보내도 행 하나다.
     *
     * @return 계정이 활성이 아니면 {@code null}
     */
    Accepted submit(NewSurvey survey, Instant now);

    /** @param practiceId 어느 화면에서 나갔는지의 근거. 연습을 특정할 수 없으면 {@code null} */
    record NewSurvey(
            UUID userId,
            UUID requestId,
            UUID practiceId,
            String screen,
            String trigger,
            String body,
            String contactEmail,
            String contactPhone) {
    }

    /** @param created 이번 요청이 새로 만들었으면 참. 재전송이면 거짓 */
    record Accepted(UUID id, boolean created) {
    }

    /** 이 계정에 이미 물어봤는가 (users.exit_survey_asked_at). */
    boolean asked(UUID userId);

    /**
     * 노출 표식을 <b>원자적으로 선점</b>한다 — 두 기기가 동시에 자동 노출 조건이어도 하나만 참을 받는다.
     *
     * @return 이번 요청이 선점했으면 참. 이미 물어본 계정이면 거짓
     */
    boolean claimAsk(UUID userId, Instant now);

    /** 아직 시트에 못 보낸 설문. 오래된 것부터 준다. */
    List<SheetRow> pendingSheetRows(int limit);

    /** 시트 한 줄. 같은 {@code id} 는 한 줄이고 {@code seq} 가 작은 전송은 무시된다. */
    record SheetRow(
            UUID id,
            int seq,
            UUID userId,
            UUID practiceId,
            String screen,
            String trigger,
            String body,
            String contactEmail,
            String contactPhone,
            Instant createdAt) {
    }

    /** 그 순번의 전송이 성공했다고 적는다. 그 사이 순번이 올라갔으면 아무것도 쓰지 않는다. */
    void markSheetSynced(UUID id, int seq, Instant now);

    /**
     * 접수 90일이 지난 연락처를 비우고 순번을 올린다 — 시트의 연락처도 지우기 위해 다시 보내야 하므로
     * {@code sheet_synced_at} 을 NULL 로 되돌린다(practice.feedback).
     *
     * @return 이번에 비운 설문 수
     */
    int purgeExpiredContacts(Instant acceptedBefore, Instant now);
}
