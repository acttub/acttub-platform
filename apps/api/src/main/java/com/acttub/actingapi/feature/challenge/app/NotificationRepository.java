package com.acttub.actingapi.feature.challenge.app;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 알림함과 푸시 발송 (challenge.notification). 알림함은 묶음(group_key) 단위이고, 묶음의 인원·수는 지금도 유효한(취소·삭제
 * 되지 않은) 사건만 센다. 발송은 커밋 뒤 따로 돌며, 발송 직전 계정·토글·토큰·언어·사건의 현재 노출 조건을 다시 본다.
 */
public interface NotificationRepository {
    Inbox inbox(UUID user, String cursor, Instant now);
    void read(UUID user, List<String> groupKeys, Instant before, UUID beforeId, Instant now);
    long unread(UUID user, Instant now);

    /**
     * 때가 된 묶음을 선점해 보낼 것을 만든다. 행의 상태(attempted·skipped)는 이 호출 안에서 확정되고, 실제 전송은 부르는
     * 쪽이 커밋 뒤에 한다(최선 노력).
     */
    List<Outgoing> dispatch(Instant now, int groups);

    /** "등록되지 않은 기기"로 답이 온 토큰을 지운다. */
    void forgetTokens(List<String> tokens);

    record Outgoing(String token, String body, Map<String, String> data) { }

    @Schema(name = "ChallengeNotificationGroup", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Group(@Schema(requiredMode = REQUIRED) String groupKey,
                 @Schema(requiredMode = REQUIRED,
                         allowableValues = {"entry_liked", "entry_commented", "challenge_ended", "entry_ai_report_ready"}) String kind,
                 @Schema(requiredMode = REQUIRED, description = "유효한 서로 다른 행동자 수(시스템 사건은 0)") long actorCount,
                 @Schema(requiredMode = REQUIRED, description = "유효한 사건 수(댓글 묶음은 댓글 수)") long eventCount,
                 @Schema(requiredMode = REQUIRED, nullable = true, description = "대표 행동자의 현재 이름. 탈퇴했으면 \"탈퇴한 사용자\"")
                 String actorName,
                 @Schema(requiredMode = REQUIRED) UUID challengeId,
                 @Schema(requiredMode = REQUIRED, nullable = true) UUID entryId,
                 @Schema(requiredMode = REQUIRED, nullable = true) UUID commentId,
                 @Schema(requiredMode = REQUIRED, nullable = true, description = "최신 댓글의 앞부분(볼 수 있을 때만)") String commentExcerpt,
                 @Schema(requiredMode = REQUIRED) Instant latestAt,
                 @Schema(requiredMode = REQUIRED) boolean read,
                 @Schema(requiredMode = REQUIRED, description = "대상이 삭제·비공개·숨김으로 볼 수 없으면 false(본인 AI 리포트는 예외)")
                 boolean targetAvailable) { }

    @Schema(name = "ChallengeNotifications", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Inbox(@Schema(requiredMode = REQUIRED) List<Group> groups,
                 @Schema(requiredMode = REQUIRED, nullable = true) String nextCursor) { }
}
