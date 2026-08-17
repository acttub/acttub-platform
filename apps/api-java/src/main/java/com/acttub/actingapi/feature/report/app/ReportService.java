package com.acttub.actingapi.feature.report.app;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import com.acttub.actingapi.platform.ledger.SyncOperationBegin;
import com.acttub.actingapi.platform.ledger.SyncOperationClaim;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.feature.report.domain.ReportBranch;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Service;

/**
 * 성적표의 규칙. HTTP 도 SQL 도 모르며, 요청 하나가 어떤 순서로 무엇을 확인하고 무엇을 남기는지만
 * 안다.
 *
 * <p>없음·충돌을 {@link ApiException} 으로 던진다. 배관(web)의 타입이지만 다른 feature 의 것이
 * 아니므로 도메인 사이의 결합은 아니다 — 이 예외를 상태코드와 본문으로 옮기는 일은
 * {@code platform/web/ApiErrorAdvice} 하나가 맡고 있고, 그 형태가 곧 계약이다.
 */
@Service
public class ReportService {

    /** 재생 서명 주소의 수명. 파이썬과 같은 15분이며, 하네스가 이 값으로 응답을 대조한다. */
    private static final int PLAYBACK_URL_TTL_SECONDS = 15 * 60;

    private final ReportRepository reports;
    private final ReportSourceProvider sources;
    private final PracticeReportLedger practiceReports;
    private final ReportOperationLedger operations;
    private final ReportEngine engine;
    private final ReportPlayback playback;

    public ReportService(
            ReportRepository reports,
            ReportSourceProvider sources,
            PracticeReportLedger practiceReports,
            ReportOperationLedger operations,
            ReportEngine engine,
            ReportPlayback playback) {
        this.reports = reports;
        this.sources = sources;
        this.practiceReports = practiceReports;
        this.operations = operations;
        this.engine = engine;
        this.playback = playback;
    }

    /**
     * 코치 세션 하나로 성적표를 만든다.
     *
     * <p>같은 핸드오프로 이미 만들어 둔 것이 있으면 <b>모델을 부르지 않고</b> 그것을 그대로 돌려준다 —
     * 성적표는 한 연습에 하나이고 만드는 데 오래 걸린다. 차단 노트도 저장하지 않는다: 그것은 성적표를
     * 만들지 않기로 했다는 표시일 뿐이라 다음 요청이 다시 판정해야 한다.
     */
    public ReportPayload create(UUID userId, UUID coachSessionId, String requestIdHeader) {
        OwnedReportSource source = sources.getOwnedReportSource(userId, coachSessionId);
        if (source == null) {
            throw new ApiException(404, "session not found");
        }
        UUID requestId = operations.requestId(requestIdHeader);
        SyncOperationBegin begun = operations.begin(
                userId,
                source.practiceSessionId(),
                requestId,
                "report",
                operations.fingerprint(
                        "report", Map.of("session_id", coachSessionId.toString())));
        if (begun.isReplay()) {
            return new ReportPayload(begun.replayPayload(), requestId);
        }
        SyncOperationClaim claim = begun.claim();

        try {
            JsonNode existing = source.handoffId() == null
                    ? null
                    : sources.getPracticeReportForHandoff(source.handoffId());
            JsonNode report = existing == null ? reportFor(source) : existing;
            // ⚠ 아래 갈래는 CoachService.confirm 과 모양이 같다. 다른 것은 원장에 남기는 값
            // 하나뿐이다 — 여기는 성적표 본문이 곧 응답이지만 저쪽은 확정 응답 전체를 남긴다.
            if (isBlocked(report) || existing != null) {
                operations.complete(claim, report);
            } else {
                boolean saved = practiceReports.completePracticeReportOperation(
                        claim.operationId(),
                        claim.leaseToken(),
                        source.practiceSessionId(),
                        typeOf(report),
                        report,
                        source.handoffId(),
                        report,
                        operations.now());
                if (!saved) {
                    operations.fail(claim, "report_already_exists");
                    throw new ApiException(409, "report already exists");
                }
            }
            return new ReportPayload(report, claim.requestId());
        } catch (ReportParseError exception) {
            operations.fail(claim, "report_parse_error");
            throw new ApiException(502, exception.getMessage());
        } catch (LeaseOwnershipException exception) {
            operations.fail(claim, "lease_ownership_lost");
            throw new ApiException(409, "request is still processing");
        } catch (ApiException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            operations.fail(claim, "report_failed");
            throw exception;
        }
    }

    public List<ReportSummary> history(UUID userId) {
        return reports.listSummaries(userId);
    }

    /**
     * 이 성적표가 <b>만들지 않기로 했다는 표시</b>인지.
     *
     * <p>차단 노트는 저장하지 않는다 — 다음 요청이 다시 판정해야 하기 때문이다. 그 판단이 필요한
     * 자리가 {@code coach} 에도 있어 질문을 여기 둔다. 본문의 어느 필드가 갈래를 담는지는 성적표의
     * 사정이지 부르는 쪽이 알 것이 아니다.
     */
    public boolean isBlocked(JsonNode report) {
        return ReportBranch.isBlocked(typeOf(report));
    }

    /** 성적표가 스스로 밝힌 갈래. 저장할 때 열에 그대로 들어간다. */
    public String typeOf(JsonNode report) {
        return report.path("report_type").asText();
    }

    /**
     * 성적표 하나와 그 연습의 재생 주소.
     *
     * <p>성적표를 먼저 찾는다 — 남의 것을 물었을 때 스토리지가 설정돼 있는지가 응답에 새면 안 된다.
     */
    public PlayableReport detail(UUID userId, UUID practiceSessionId) {
        ReportDetail detail = reports.findDetail(userId, practiceSessionId);
        if (detail == null) {
            throw new ApiException(404, "report_not_found");
        }
        return new PlayableReport(
                detail, playback.url(detail.objectKey(), PLAYBACK_URL_TTL_SECONDS));
    }

    /**
     * 확정된 핸드오프 하나로 성적표를 만든다.
     *
     * <p>{@code coach} 도 이것을 부른다 — 핸드오프를 확정하는 자리(`/v2/coach/confirm`)와 성적표를
     * 따로 요청하는 자리(`/v2/reports`)가 같은 원본에서 같은 성적표를 내야 한다. 조립을 양쪽에 두면
     * 인자 하나가 어긋나는 날 두 경로의 성적표가 갈린다.
     */
    public JsonNode reportFor(OwnedReportSource source) {
        return engine.generateReport(
                source.branchKind(),
                source.videoSummary(),
                source.handoffJson(),
                source.confirmed(),
                source.handoffId() == null ? "" : source.handoffId().toString(),
                source.analysisHandoffJson(),
                source.analysisHandoffId() == null
                        ? null
                        : source.analysisHandoffId().toString());
    }
}
