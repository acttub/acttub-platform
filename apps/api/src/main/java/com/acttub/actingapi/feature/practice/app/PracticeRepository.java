package com.acttub.actingapi.feature.practice.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.PracticeViews.GroupView;
import com.acttub.actingapi.feature.practice.app.PracticeViews.PracticeView;

/**
 * practice 가 저장소에 요구하는 것 — 1.0.0 회차·묶음과 분석 작업 (practice.start, practice.resume,
 * practice.analyze). 옛 {@code practice_sessions} 를 읽는 {@link PracticeSessionRepository} 와 다른 포트다.
 *
 * <p>없음을 {@code null} 로 알린다(ADR-018).
 *
 * <p><b>회차와 분석 작업은 한 트랜잭션에서 만든다</b> — 도중에 실패하면 회차도 작업도 없다. 그 트랜잭션은
 * <b>영상 행</b>(보관함의 삭제·파기와 같은 행)과, 이어하기면 <b>묶음</b>과, 게스트면 <b>사용자 행</b>을 잡는다.
 */
public interface PracticeRepository {

    /**
     * 첫 회차(새 묶음)를 만들고 분석 작업을 건다. {@code root_id = id}·{@code ordinal = 1}·{@code stage
     * analyzing} 이다.
     */
    Started start(UUID userId, NewPractice practice, Quota quota, Instant now);

    /**
     * 같은 묶음의 다음 회차를 만든다. 차수는 묶음을 잠그고 {@code (root_id, ordinal)} 유일로 발급한다.
     *
     * @param from 이어받을 회차. 그 회차의 묶음에 닫히지 않은 회차가 있으면 {@link StartOutcome#IN_PROGRESS}
     * @param videoId {@code null} 이면 이어받을 회차의 영상을 그대로 쓴다
     */
    Started continueGroup(UUID userId, UUID from, UUID videoId, NewPractice practice, Quota quota, Instant now);

    /**
     * 실패한 회차의 분석을 다시 건다 — 새 작업과 함께 {@code analyzing} 으로 돌아간다. 묶음에 다른 진행 중
     * 회차가 있으면 {@link StartOutcome#IN_PROGRESS} 다.
     */
    Started retryAnalysis(UUID userId, UUID practiceId, UUID requestId, String fingerprint, Quota quota, Instant now);

    /**
     * @param requestId 기기가 만든 요청 id. {@code (user_id, request_id)} 유일이라 재전송이 회차를 둘 만들지 않는다
     * @param fingerprint 생성 본문의 지문. 같은 id 에 다른 지문이면 {@link StartOutcome#FINGERPRINT_MISMATCH}
     */
    record NewPractice(
            UUID requestId,
            String fingerprint,
            UUID videoId,
            String experienceVersion,
            String situation,
            String characterContext,
            String goal,
            String blockageKind,
            String subBranch,
            String blockageNote) {
    }

    /**
     * 게스트의 하루 한도. 회원은 {@code null} 이다.
     *
     * @param since 한국 시간 오늘 0시
     */
    record Quota(int limit, Instant since) {
    }

    /** @param practice 만들었거나(CREATED) 같은 요청이 이미 만든(REPLAYED) 회차. 그 밖에는 {@code null} */
    record Started(StartOutcome outcome, PracticeView practice) {
    }

    enum StartOutcome {
        CREATED,
        /** 같은 요청 id·같은 지문. 같은 회차다. */
        REPLAYED,
        /** 영상이 없거나 남의 것이거나 파일이 파기됐다. */
        VIDEO_NOT_READY,
        /** 묶음에 닫히지 않은 회차가 있다. */
        IN_PROGRESS,
        /** 게스트의 하루 분석 한도를 넘겼다. */
        QUOTA,
        /** 같은 요청 id·다른 본문. */
        FINGERPRINT_MISMATCH,
        /** 이어받을 회차·재시도할 회차가 없거나 남의 것이다. */
        NOT_FOUND,
        /** 재시도는 실패로 닫힌 회차에만 된다. */
        NOT_FAILED
    }

    /** 회차 하나. 없거나 남의 것이면 {@code null}. */
    PracticeView find(UUID userId, UUID practiceId);

    /** 회차의 진행 상태만. 없거나 남의 것이면 {@code null}. */
    PracticeViews.StatusView status(UUID userId, UUID practiceId);

    /**
     * 묶음 목록. 최근 활동 순이고 숨긴 묶음은 빠진다.
     *
     * @param filter {@code all}·{@code favorite}·{@code recent30}
     */
    List<GroupView> groups(UUID userId, String filter, Instant now);

    /**
     * 진행 중인 분석을 배우가 그만둔다 — 작업을 {@code failed}/{@code cancelled} 로 닫고 <b>lease 를 지워</b>
     * 늦은 완료와 재큐를 막는다. 회차는 {@code closed} 다.
     *
     * @return 없거나 남의 것이면 {@code null}, 이미 끝난 분석이면 {@link CancelOutcome#ALREADY_DONE}
     */
    Cancelled cancel(UUID userId, UUID practiceId, Instant now);

    record Cancelled(CancelOutcome outcome, PracticeViews.StatusView status) {
    }

    enum CancelOutcome {
        CANCELLED,
        /** 분석이 이미 끝났다(성공·실패). */
        ALREADY_DONE,
        NOT_FOUND
    }

    /**
     * 묶음 속성을 바꾼다 — 보낸 것만 바꾼다. 속성은 <b>첫 행</b>에 있고 숨김은 묶음 전체다(개별 회차 숨김은 없다).
     *
     * @return 없거나 남의 묶음이면 {@code null}
     */
    GroupView updateGroup(UUID userId, UUID rootId, Boolean favorite, Boolean hidden, String title, Instant now);
}
