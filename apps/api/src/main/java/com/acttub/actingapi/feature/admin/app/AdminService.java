package com.acttub.actingapi.feature.admin.app;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminAdvisorSession;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminAdvisorSessions;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminChallenge;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminChallengePage;
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
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminUploadPlayback;
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

    /** 업로드만 한 영상 전용 재생 주소의 고정 수명. */
    public static final int UPLOAD_PLAYBACK_TTL_SECONDS = 600;

    /** ops 화면이 날짜를 한국 시각으로 끊는다. 수집기 백업 경로의 as_of 와 같은 모양으로 낸다. */
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final ObjectMapper JSON = new ObjectMapper();

    /**
     * 자문위원 이메일 해시 목록. 코치 성격 배정(SOMA-622)이 읽는 파일과 <b>같은 파일</b>을 읽는다 —
     * 자문위원을 가르는 목록이 두 벌이 되면 서로 어긋난다.
     */
    public static final String ADVISORS_RESOURCE = "/coaching/direct-video/personas/advisors.txt";

    private final AdminMetricsRepository metrics;
    private final AdminPlayback playback;
    private final List<String> excludeEmails;
    private final Set<String> advisorEmailHashes;

    public AdminService(
            AdminMetricsRepository metrics,
            AdminPlayback playback,
            @Value("${ADMIN_OPS_EXCLUDE_EMAILS:}") String excludeEmails,
            @Value("${ADMIN_ADVISORS_RESOURCE:" + ADVISORS_RESOURCE + "}") String advisorsResource) {
        this.metrics = metrics;
        this.playback = playback;
        this.excludeEmails = Arrays.stream(excludeEmails.split(","))
                .map(String::strip)
                .filter(value -> !value.isEmpty())
                .toList();
        this.advisorEmailHashes = advisorEmailHashes(advisorsResource);
    }

    /**
     * 빈 경로면 자문위원이 없다. 한 줄은 해시 하나이거나 "해시 사람-id" 다(자문위원별 프롬프트로 바뀌며 id 가 붙는다).
     * 앞 64자 해시만 쓰고, 주석(#)·빈 줄·이 모양이 아닌 줄은 건너뛴다.
     */
    static Set<String> advisorEmailHashes(String resource) {
        if (resource == null || resource.isBlank()) {
            return Set.of();
        }
        try (InputStream input = AdminService.class.getResourceAsStream(resource)) {
            if (input == null) {
                throw new IllegalStateException("missing advisor list: " + resource);
            }
            return new String(input.readAllBytes(), StandardCharsets.UTF_8).lines()
                    .map(String::strip)
                    .filter(line -> line.matches("[0-9a-f]{64}(\\s+[a-z][a-z-]*)?"))
                    .map(line -> line.substring(0, 64))
                    .collect(Collectors.toUnmodifiableSet());
        } catch (IOException error) {
            throw new IllegalStateException("cannot read advisor list: " + resource, error);
        }
    }

    /** ops 검색용 가명 → 프로필 이름. 이름이 있는 활성 계정만. */
    public AdminMetrics.AdminActorNames actorNames() {
        return new AdminMetrics.AdminActorNames(metrics.actorNames());
    }

    /** 자문위원 계정의 코치 대화만, 최신순. 영상은 세션 목록과 같은 1시간 재생 주소를 붙인다. */
    public AdminAdvisorSessions advisorSessions(int limit) {
        List<AdminAdvisorSession> sessions = new ArrayList<>();
        for (AdminMetricsRepository.AdvisorSessionRow row : metrics.advisorSessions(limit, advisorEmailHashes)) {
            AdminAdvisorSession s = row.session();
            sessions.add(new AdminAdvisorSession(
                    s.coachSessionId(), s.createdAt(), s.actor(), s.advisorHash(), s.persona(), s.status(),
                    s.closeReason(), s.situation(), s.characterContext(), s.goal(), s.turns(),
                    row.objectKey() == null ? null : playback.url(row.objectKey(), PLAYBACK_TTL_SECONDS), s.coachFlow()));
        }
        return new AdminAdvisorSessions(List.copyOf(sessions), advisorEmailHashes.size(), PLAYBACK_TTL_SECONDS);
    }

    public AdminSessions sessions(int limit, List<UUID> ids) {
        List<AdminSession> sessions = new ArrayList<>();
        for (AdminMetricsRepository.SessionRow row : metrics.sessions(limit, excludeEmails, ids)) {
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
                            : playback.url(row.objectKey(), PLAYBACK_TTL_SECONDS),
                    row.coachFlow()));
        }
        return new AdminSessions(List.copyOf(sessions), PLAYBACK_TTL_SECONDS);
    }

    public AdminFeedbackPage feedback(int limit, List<String> excludeActors, boolean includeTeam) {
        var rows = metrics.feedback(limit + 1, excludeEmails, excludeActors, includeTeam);
        return new AdminFeedbackPage(rows.stream().limit(limit).toList(), limit, rows.size() > limit);
    }

    public AdminChallengePage challenges(int limit, List<String> excludeActors) {
        List<AdminChallenge> rows = metrics.challenges(limit, excludeEmails, excludeActors);
        return new AdminChallengePage(rows, rows.size());
    }

    public AdminChallengeVideoPage challengeVideos(
            int limit,
            List<String> excludeActors,
            String visibility) {
        List<AdminChallengeVideo> entries = metrics.challengeVideos(
                limit, excludeEmails, excludeActors, visibility);
        return new AdminChallengeVideoPage(entries, entries.size());
    }

    public AdminMetrics.AdminChallengeCommentPage challengeComments(int limit, List<String> excludeActors) {
        List<AdminMetrics.AdminChallengeComment> rows = metrics.challengeComments(limit, excludeEmails, excludeActors);
        return new AdminMetrics.AdminChallengeCommentPage(rows, rows.size());
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

    public AdminUploadPlayback uploadOnlyVideoPlayback(UUID uploadIntentId, List<String> excludeActors) {
        String objectKey = metrics.uploadOnlyVideoObjectKey(uploadIntentId, excludeEmails, excludeActors)
                .orElseThrow(() -> new ApiException(404, "upload_video_not_found"));
        try {
            String playbackUrl = playback.requiredUrl(objectKey, UPLOAD_PLAYBACK_TTL_SECONDS);
            if (playbackUrl == null || playbackUrl.isBlank()) {
                throw new IllegalStateException("admin playback signer returned no URL");
            }
            return new AdminUploadPlayback(playbackUrl, UPLOAD_PLAYBACK_TTL_SECONDS);
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
