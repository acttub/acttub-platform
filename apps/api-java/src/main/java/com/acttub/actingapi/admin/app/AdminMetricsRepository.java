package com.acttub.actingapi.admin.app;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * admin 이 저장소에 요구하는 것 — 지표 한 벌과 최근 코치 세션.
 *
 * <p><b>이 도메인은 다른 도메인의 테이블을 가로질러 읽는다.</b> 그 사실은 여기 SQL 안에만
 * 있고 패키지 의존으로는 새어 나오지 않는다 — 구현이 {@code coach}·{@code practice} 를 한 줄도
 * import 하지 않으므로 도메인 사이의 결합은 아니다. 지표를 도메인별 포트로 쪼개는 안은
 * 택하지 않았다. 한 지표가 서너 테이블을 조인해 세는 형태라 쪼개면 자바에서 다시 맞춰야 하고,
 * 그 순간 세는 방식이 SQL 과 자바 두 곳으로 갈린다.
 *
 * <p>제외 이메일 목록을 그대로 받는 이유도 같다 — 팀 계정을 뺀 수(<i>real</i>)와 전체 수를
 * <b>한 번의 집계에서</b> 함께 내야 둘이 어긋나지 않는다.
 */
public interface AdminMetricsRepository {

    AdminMetrics.AdminStats stats(List<String> excludeEmails);

    /** 최근 코치 세션. 오브젝트 키는 재생 주소를 만들 수 있을 때만 채워져 있다. */
    List<SessionRow> sessions(int limit, List<String> excludeEmails);

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
