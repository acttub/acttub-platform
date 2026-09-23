package com.acttub.actingapi.feature.challenge.app;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 신고와 운영 처리 (challenge.report). 참여작·댓글은 유효한 첫 신고와 숨김을 대상 행을 잠근 한 트랜잭션에서 하고,
 * 챌린지는 처리되지 않은 신고가 서로 다른 세 사람에게서 모이면 검토로 올린다. 판정은 대상 행을 잠그고 남은 접수를
 * 확인한 뒤 적용한다.
 */
public interface ReportRepository {
    Filed file(UUID reporter, UUID requestId, String fingerprint, NewReport report, Instant now);
    AdminReportPage list(String status, String cursor, Instant now);
    AdminReport resolve(UUID id, String resolution, String reviewer, String note, Instant now);

    record NewReport(String targetType, UUID targetId, String reason, String note) { }
    record Filed(Receipt receipt, boolean created) { }

    @Schema(name = "ReportReceipt", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Receipt(@Schema(requiredMode = REQUIRED) UUID id,
                   @Schema(requiredMode = REQUIRED, allowableValues = {"received", "reviewed"}) String status) { }

    @Schema(name = "AdminChallengeReport", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AdminReport(@Schema(requiredMode = REQUIRED) UUID id,
                       @Schema(requiredMode = REQUIRED, allowableValues = {"entry", "comment", "challenge"}) String targetType,
                       @Schema(requiredMode = REQUIRED) UUID targetId,
                       @Schema(requiredMode = REQUIRED) String reason,
                       @Schema(requiredMode = REQUIRED, nullable = true) String note,
                       @Schema(requiredMode = REQUIRED) String status,
                       @Schema(requiredMode = REQUIRED, nullable = true) String resolution,
                       @Schema(requiredMode = REQUIRED, nullable = true) String reviewedBy,
                       @Schema(requiredMode = REQUIRED, nullable = true) Instant reviewedAt,
                       @Schema(requiredMode = REQUIRED, nullable = true) String resolutionNote,
                       @Schema(requiredMode = REQUIRED, description = "신고 당시 대상의 content_version") int targetVersion,
                       @Schema(requiredMode = REQUIRED, nullable = true, description = "지금 대상의 content_version. 없어졌으면 null")
                       Integer currentVersion,
                       @Schema(requiredMode = REQUIRED, nullable = true, description = "신고 당시 캡션·댓글·대사") String reportedText,
                       @Schema(requiredMode = REQUIRED, nullable = true, description = "지금의 캡션·댓글·대사") String currentText,
                       @Schema(requiredMode = REQUIRED, description = "대상의 현재 상태(visible·hidden·review·private·deleted 등)")
                       String targetState,
                       @Schema(requiredMode = REQUIRED, description = "이 대상에 남은 처리 전 신고 수") long openReports,
                       @Schema(requiredMode = REQUIRED) Instant createdAt,
                       @Schema(requiredMode = REQUIRED, description = "첫 확인 목표(접수 + 24시간)") Instant firstCheckDue,
                       @Schema(requiredMode = REQUIRED, description = "처리 또는 지연 안내 목표(접수 + 72시간)") Instant resolveDue) { }

    @Schema(name = "AdminChallengeReportPage", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AdminReportPage(@Schema(requiredMode = REQUIRED) List<AdminReport> reports,
                           @Schema(requiredMode = REQUIRED, nullable = true) String nextCursor) { }
}
