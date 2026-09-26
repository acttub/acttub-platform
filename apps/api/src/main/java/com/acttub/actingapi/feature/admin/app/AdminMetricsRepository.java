package com.acttub.actingapi.feature.admin.app;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

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
