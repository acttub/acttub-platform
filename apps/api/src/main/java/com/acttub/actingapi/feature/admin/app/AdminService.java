package com.acttub.actingapi.feature.admin.app;

import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminChallengePlayback;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminChallengeVideo;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminChallengeVideoPage;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminFeedbackPage;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminReadingPlayback;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminReadingSession;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminReadingSessionDetail;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminReadingSessionPage;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminSession;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminSessions;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.acttub.actingapi.platform.web.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.stereotype.Service;

/**
 * 운영 세션 조회의 규칙. 읽는 것은 SQL 이 하고, 여기서는 <b>어느 계정을 빼는지</b>와
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
@ConditionalOnExpression(AdminService.ENABLED_WHEN)
public class AdminService {

    /**
     * 이 기능이 서는 조건. <b>컨트롤러와 서비스가 같은 조건을 져야 하므로</b> 리터럴을 흩지
     * 않는다 — 하나라도 빠지면 토큰을 주지 않은 기동에서 컨텍스트가 뜨지 못한다.
     */
    public static final String ENABLED_WHEN =
            "T(org.springframework.util.StringUtils).hasText('${ADMIN_OPS_TOKEN:}')";

    /** 세션 목록 재생 주소의 수명. 파이썬 정본과 같은 1시간이고, 응답에 그대로 실린다. */
    public static final int PLAYBACK_TTL_SECONDS = 3600;

    /** 챌린지 영상 전용 재생 주소의 고정 수명. */
    public static final int CHALLENGE_PLAYBACK_TTL_SECONDS = 600;

    /** 리딩 녹음 전용 재생 주소의 고정 수명. */
    public static final int READING_PLAYBACK_TTL_SECONDS = 600;

    /** ops 화면이 날짜를 한국 시각으로 끊는다. 수집기 백업 경로의 as_of 와 같은 모양으로 낸다. */
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final ObjectMapper JSON = new ObjectMapper();

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

    public AdminFeedbackPage feedback(int limit, List<String> excludeActors, boolean includeTeam) {
        var rows = metrics.feedback(limit + 1, excludeEmails, excludeActors, includeTeam);
        return new AdminFeedbackPage(rows.stream().limit(limit).toList(), limit, rows.size() > limit);
    }

    public AdminChallengeVideoPage challengeVideos(
            int limit,
            List<String> excludeActors,
            String visibility) {
        List<AdminChallengeVideo> entries = metrics.challengeVideos(
                limit, excludeEmails, excludeActors, visibility);
        return new AdminChallengeVideoPage(entries, entries.size());
    }

    public AdminChallengePlayback challengeVideoPlayback(UUID entryId, List<String> excludeActors) {
        String objectKey = metrics.challengeVideoObjectKey(entryId, excludeEmails, excludeActors)
                .orElseThrow(() -> new ApiException(404, "challenge_video_not_found"));
        try {
            String playbackUrl = playback.requiredUrl(objectKey, CHALLENGE_PLAYBACK_TTL_SECONDS);
            if (playbackUrl == null || playbackUrl.isBlank()) {
                throw new IllegalStateException("admin playback signer returned no URL");
            }
            return new AdminChallengePlayback(playbackUrl, CHALLENGE_PLAYBACK_TTL_SECONDS);
        } catch (Exception failure) {
            throw ApiException.external(503, "playback_unavailable", failure);
        }
    }

    public AdminReadingSessionPage readingSessions(
            int limit,
            String status,
            List<String> excludeActors) {
        List<AdminReadingSession> sessions = metrics.readingSessions(
                limit, status, excludeEmails, excludeActors);
        return new AdminReadingSessionPage(sessions, sessions.size());
    }

    public AdminReadingSessionDetail readingSession(UUID sessionId, List<String> excludeActors) {
        return metrics.readingSession(sessionId, excludeEmails, excludeActors)
                .orElseThrow(() -> new ApiException(404, "reading_session_not_found"));
    }

    public AdminReadingPlayback readingRecordingPlayback(
            UUID recordingId,
            List<String> excludeActors) {
        String objectKey = metrics.readingRecordingObjectKey(
                        recordingId, excludeEmails, excludeActors)
                .orElseThrow(() -> new ApiException(404, "reading_recording_not_found"));
        try {
            String playbackUrl = playback.requiredUrl(objectKey, READING_PLAYBACK_TTL_SECONDS);
            if (playbackUrl == null || playbackUrl.isBlank()) {
                throw new IllegalStateException("admin playback signer returned no URL");
            }
            return new AdminReadingPlayback(playbackUrl, READING_PLAYBACK_TTL_SECONDS);
        } catch (Exception failure) {
            throw ApiException.external(503, "playback_unavailable", failure);
        }
    }

    /**
     * ops 코어 지표를 운영 DB 에서 바로 센다. 모양은 수집기 CORE_SQL 의 JSON 그대로이고,
     * 백업 경로({@code source=backup})와 구분되도록 {@code source=live} 와 기준 시각을 붙인다.
     */
    public ObjectNode opsCore(List<String> excludeActors) {
        try {
            ObjectNode core = (ObjectNode) JSON.readTree(metrics.opsCore(excludeEmails, excludeActors));
            core.put("source", "live");
            core.put("as_of", OffsetDateTime.now(KST).truncatedTo(ChronoUnit.MINUTES).toString());
            return core;
        } catch (JsonProcessingException | ClassCastException invalid) {
            throw new IllegalStateException("ops core query did not return a JSON object", invalid);
        }
    }
}
