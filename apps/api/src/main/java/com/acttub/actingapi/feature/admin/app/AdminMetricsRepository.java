package com.acttub.actingapi.feature.admin.app;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminChallenge;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminChallengeVideo;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminFeedbackItem;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminReadingSession;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminReadingSessionDetail;

/**
 * admin 이 저장소에 요구하는 것 — 최근 코치 세션.
 *
 * <p><b>이 도메인은 다른 도메인의 테이블을 가로질러 읽는다.</b> 그 사실은 여기 SQL 안에만
 * 있고 패키지 의존으로는 새어 나오지 않는다 — 구현이 {@code coach}·{@code practice} 를 한 줄도
 * import 하지 않으므로 도메인 사이의 결합은 아니다. 지표를 도메인별 포트로 쪼개는 안은
 * 택하지 않았다. 한 지표가 서너 테이블을 조인해 세는 형태라 쪼개면 자바에서 다시 맞춰야 하고,
 * 그 순간 세는 방식이 SQL 과 자바 두 곳으로 갈린다.
 *
 * <p>지표 집계 한 벌({@code /v2/admin/stats})이 여기 있었다. 부르는 코드도 보는 사람도 없어
 * 은퇴했고, 남은 것은 ops 대시보드가 실제로 읽는 세션 목록뿐이다 (SOMA-462).
 *
 * <p>{@link #opsCore} 는 그 은퇴한 집계의 부활이 아니다. ops 수집기가 하루 한 번 백업에서 돌리던
 * SQL 을 <b>글자 그대로</b> 옮겨 운영 DB 에서 바로 돌린다 — 부르는 쪽(ops.acttub.com)이 있고,
 * 세는 방식은 여전히 SQL 한 곳({@code resources/admin/ops-core.sql})에만 있다.
 */
public interface AdminMetricsRepository {

    /** 최근 코치 세션. 오브젝트 키는 재생 주소를 만들 수 있을 때만 채워져 있다. */
    List<SessionRow> sessions(int limit, List<String> excludeEmails);

    /**
     * ops 코어 지표 한 벌 — {@code resources/admin/ops-core.sql} 이 만든 JSON 문자열 그대로.
     * 팀 계정은 빼지 않고 {@code *_real}·{@code is_team} 으로 표시만 한다(수집기 계약).
     * 팀은 이메일 목록과, 이메일이 없는 게스트를 위한 가명 목록(md5(user_id) 앞 8자리) 둘로 정한다.
     */
    String opsCore(List<String> excludeEmails, List<String> excludeActors);

    /**
     * 이탈 설문과 노트 평가를 한 시간순 목록으로 읽는다. 연락처·원본 user id·이메일은 projection 에
     * 넣지 않는다. {@code limit} 은 has_more 판정을 위한 요청 상한보다 한 건 큰 값이다.
     */
    List<AdminFeedbackItem> feedback(
            int limit,
            List<String> excludeEmails,
            List<String> excludeActors,
            boolean includeTeam);

    /**
     * 삭제되지 않은 챌린지 전부(팀 계정이 연 것 포함). 진행 중 → 예정 → 종료 순, 같은 상태는 최근 시작 순이다.
     * 참여작 수는 삭제를 뺀 전체·공개·팀 밖(팀 이메일·exclude_actors 제외) 셋이다.
     */
    List<AdminChallenge> challenges(
            int limit,
            List<String> excludeEmails,
            List<String> excludeActors);

    /** 공개·비공개 챌린지 참여 영상. 개인 식별자와 원본 저장소 정보는 projection 에 넣지 않는다. */
    List<AdminChallengeVideo> challengeVideos(
            int limit,
            List<String> excludeEmails,
            List<String> excludeActors,
            String visibility);

    /** 재생이 허용된 참여작의 오브젝트 키. 없음·팀·삭제·파기된 영상은 모두 빈 값이다. */
    Optional<String> challengeVideoObjectKey(
            UUID entryId,
            List<String> excludeEmails,
            List<String> excludeActors);

    /** 활성 계정의 리딩 회차 목록. 자유 본문과 저장소 키는 projection 에 넣지 않는다. */
    List<AdminReadingSession> readingSessions(
            int limit,
            String status,
            List<String> excludeEmails,
            List<String> excludeActors);

    /** 활성 계정의 리딩 회차와 그 대본·녹음. 부모 연결이 하나라도 어긋나면 빈 값이다. */
    Optional<AdminReadingSessionDetail> readingSession(
            UUID sessionId,
            List<String> excludeEmails,
            List<String> excludeActors);

    /** 재생이 허용된 리딩 녹음의 m4a 오브젝트 키. 탈퇴 보관으로 연결이 끊긴 행은 빈 값이다. */
    Optional<String> readingRecordingObjectKey(
            UUID recordingId,
            List<String> excludeEmails,
            List<String> excludeActors);

    /** 세션 한 줄. 재생 주소는 아직 붙지 않았다 — 그것은 서비스가 스토리지에 물어 채운다. */
    record SessionRow(
            UUID coachSessionId,
            OffsetDateTime createdAt,
            String status,
            String closeReason,
            String situation,
            String characterContext,
            String goal,
            List<AdminMetrics.AdminTurn> turns,
            String objectKey) {
    }
}
