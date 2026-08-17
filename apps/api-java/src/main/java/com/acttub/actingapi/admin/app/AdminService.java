package com.acttub.actingapi.admin.app;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import com.acttub.actingapi.admin.app.AdminMetrics.AdminSession;
import com.acttub.actingapi.admin.app.AdminMetrics.AdminSessions;
import com.acttub.actingapi.admin.app.AdminMetrics.AdminStats;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.stereotype.Service;

/**
 * 운영 지표 조회의 규칙. 집계 자체는 SQL 이 하고, 여기서는 <b>무엇을 빼고 세는지</b>와
 * 세션에 재생 주소를 붙이는 일을 정한다.
 *
 * <p>토큰 검사와 {@code limit} 검증은 여기 없다 — 헤더와 질의 문자열을 다루는 일이고 422 본문의
 * 모양이 곧 계약이라 요청을 받는 자리(web)에 남는다.
 *
 * <p>⚠ {@code ADMIN_OPS_TOKEN} 이 없으면 이 기능은 통째로 없다. 컨트롤러와 같은 조건을 지는
 * 이유는 하나라도 빠지면 없는 빈을 요구해 컨텍스트가 기동하지 못하기 때문이다. 토큰을 주지
 * 않은 인스턴스에서 admin 이 OpenAPI 문서에 실리지 않는 것도 이 조건이 지킨다.
 */
@Service
@ConditionalOnExpression("T(org.springframework.util.StringUtils).hasText('${ADMIN_OPS_TOKEN:}')")
public class AdminService {

    /** 재생 주소의 수명. 하네스가 이 값으로 응답을 대조한다. */
    public static final int PLAYBACK_TTL_SECONDS = 3600;

    private final AdminMetricsRepository metrics;
    private final AdminPlayback playback;
    private final List<String> excludeEmails;

    public AdminService(
            AdminMetricsRepository metrics,
            AdminPlayback playback,
            @Value("${ADMIN_OPS_EXCLUDE_EMAILS:}") String excludeEmails) {
        this.metrics = metrics;
        this.playback = playback;
        this.excludeEmails = Arrays.stream(excludeEmails.split(","))
                .map(String::strip)
                .filter(value -> !value.isEmpty())
                .toList();
    }

    public AdminStats stats() {
        return metrics.stats(excludeEmails);
    }

    public AdminSessions sessions(int limit) {
        List<AdminSession> sessions = new ArrayList<>();
        for (AdminMetricsRepository.SessionRow row : metrics.sessions(limit, excludeEmails)) {
            sessions.add(new AdminSession(
                    row.coachSessionId().toString(),
                    row.createdAt(),
                    row.status(),
                    row.closeReason(),
                    row.situation(),
                    row.characterContext(),
                    row.goal(),
                    row.turns(),
                    row.objectKey() == null
                            ? null
                            : playback.url(row.objectKey(), PLAYBACK_TTL_SECONDS)));
        }
        return new AdminSessions(List.copyOf(sessions), PLAYBACK_TTL_SECONDS);
    }
}
