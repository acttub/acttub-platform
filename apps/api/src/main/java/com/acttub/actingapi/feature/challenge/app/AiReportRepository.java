package com.acttub.actingapi.feature.challenge.app;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 챌린지 AI 리포트의 저장소 (challenge.ai-report). 요청은 참여작 행을 잠근 채 한도·실행 중 생성을 보고 {@code ai_jobs}
 * (challenge_report) 하나와 리포트 행을 함께 쓴다. 저장 직전에는 계정·참여작·표본 조건을 다시 본다.
 */
public interface AiReportRepository {
    Requested request(UUID owner, UUID entryId, UUID requestId, String fingerprint, Instant now);
    Report find(UUID owner, UUID entryId);

    /** 워커의 재료. 참여작이 지워졌거나 계정이 닫혔거나 이 작업이 더는 현재 생성이 아니면 {@code null}. */
    Material material(UUID jobId, UUID entryId);

    /**
     * 결과를 저장하고 작업을 성공으로 닫는다. 저장 직전 조건을 다시 봐서 참여작·계정이 사라졌으면 저장하지 않고
     * 작업을 cancelled 로 닫는다(거짓).
     */
    boolean complete(UUID jobId, UUID leaseToken, UUID entryId, Result result, String model, Instant now);

    /** 실행 한 번이 실패했다. {@code terminal} 이면 작업·리포트를 failed 로 닫고, 아니면 다시 대기로 돌린다. */
    void attemptFailed(UUID jobId, UUID leaseToken, UUID entryId, int attempts, boolean terminal, String reason, Instant now);

    record Requested(Report report, boolean created) { }

    /** @param samples 표본 참여작. 라벨(S1…)은 워커가 붙이고 모델에게 이름·id 를 주지 않는다 */
    record Material(UUID owner, UUID entryId, String line, Video mine, List<Sample> samples) { }
    record Video(String objectKey, String contentType, int durationMs) { }
    record Sample(UUID entryId, Video video) { }

    /** 모델 출력을 검사한 뒤의 결과. 견주기 문장마다 근거 표본 참여작 id 를 든다(내부 전용). */
    record Result(List<Evidence> observations, List<Comparison> comparisons, List<String> limits, String suggestion,
                  List<UUID> samples) { }
    record Comparison(String text, List<UUID> samples) { }

    @Schema(name = "AiReportEvidence", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Evidence(@Schema(requiredMode = REQUIRED) int startMs, @Schema(requiredMode = REQUIRED) int endMs,
                    @Schema(requiredMode = REQUIRED) String text) { }

    @Schema(name = "ChallengeAiReport", additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
            description = "관찰·견주기·한계·제안. 점수·등급·순위가 없고 표본은 이름·id 없이 \"다른 참여작들\"이다")
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Report(@Schema(requiredMode = REQUIRED) UUID entryId,
                  @Schema(requiredMode = REQUIRED, allowableValues = {"pending", "ready", "failed"}) String status,
                  @Schema(requiredMode = REQUIRED) List<Evidence> observations,
                  @Schema(requiredMode = REQUIRED, description = "지금도 표본 조건을 지키는 참여작에 기댄 문장만") List<String> comparisons,
                  @Schema(requiredMode = REQUIRED) List<String> limits,
                  @Schema(requiredMode = REQUIRED, nullable = true) String suggestion,
                  @Schema(requiredMode = REQUIRED, description = "견주기에 쓴 표본 가운데 지금도 조건을 지키는 수") int sampleCount,
                  @Schema(requiredMode = REQUIRED, description = "이번 생성의 실행 수(최대 3)") int attemptCount,
                  @Schema(requiredMode = REQUIRED) Instant requestedAt,
                  @Schema(requiredMode = REQUIRED, nullable = true) Instant completedAt) { }
}
