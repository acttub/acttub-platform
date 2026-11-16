package com.acttub.actingapi.feature.billing.adapter.web;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.admin.app.AdminService;
import com.acttub.actingapi.feature.billing.app.BillingAdminReader;
import com.acttub.actingapi.feature.billing.app.BillingRules;
import com.acttub.actingapi.platform.web.ApiException;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Schema;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * ops 구독 화면(SOMA-963) — 누가 Pro 구독 중인지, 해지했지만 기간이 남았는지, 카드 없이 Pro 를 받았는지 본다.
 * {@code ADMIN_OPS_TOKEN} 을 Bearer 로 받고, 토큰이 없는 기동에는 통째로 없다. 팀 계정도 빼지 않고 is_team 으로 표시한다.
 * 사람은 가명·프로필 이름·닉네임으로만 싣는다 — 이메일·user id·카드·결제 키는 응답에 없다.
 */
@RestController
@RequestMapping("/v2/admin")
@ConditionalOnExpression(AdminService.ENABLED_WHEN)
class BillingAdminController {
    private static final Pattern ACTOR = Pattern.compile("[0-9a-f]{8}");
    private static final int MAX_ACTORS = 100;

    private final BillingAdminReader reader;
    private final Clock clock;
    private final List<String> teamEmails;
    private final byte[] expectedAuthorization;

    BillingAdminController(BillingAdminReader reader, Clock clock,
            @Value("${ADMIN_OPS_EXCLUDE_EMAILS:}") String teamEmails,
            @Value("${ADMIN_OPS_TOKEN}") String adminToken) {
        this.reader = reader;
        this.clock = clock;
        this.teamEmails = Arrays.stream(teamEmails.split(","))
                .map(email -> email.strip().toLowerCase(Locale.ROOT))
                .filter(email -> !email.isEmpty())
                .toList();
        this.expectedAuthorization = ("Bearer " + adminToken).getBytes(StandardCharsets.UTF_8);
    }

    @Schema(name = "AdminSubscriber", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Subscriber(
            String actor,
            @Schema(nullable = true) String name,
            @Schema(nullable = true) String nickname,
            boolean isTeam,
            @Schema(nullable = true) OffsetDateTime signedUpAt,
            @Schema(description = "toss · apple · google") String provider,
            @Schema(description = "monthly · yearly") String plan,
            long amount,
            @Schema(description = "active · canceled · past_due · expired") String status,
            @Schema(description = "지금 이 구독으로 Pro 인가 — 서버 판정(BillingRules.pro)과 같다") boolean proNow,
            @Schema(nullable = true) OffsetDateTime periodStart,
            @Schema(nullable = true) OffsetDateTime periodEnd,
            @Schema(nullable = true) OffsetDateTime canceledAt,
            OffsetDateTime subscribedAt,
            @Schema(description = "토스로 실제 결제된 합계. 스토어 결제는 스토어 장부에만 있어 0") long paidAmount,
            int paidCount) {
    }

    @Schema(name = "AdminProGrant", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Grant(
            String actor,
            @Schema(nullable = true) String name,
            @Schema(nullable = true) String nickname,
            boolean isTeam,
            String reason,
            OffsetDateTime startsAt,
            OffsetDateTime endsAt,
            @Schema(description = "scheduled · active · ended") String state) {
    }

    @Schema(name = "AdminLaunchWeek", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record LaunchWeek(OffsetDateTime startsAt, OffsetDateTime endsAt, boolean activeNow,
            @Schema(description = "기간 시작 전에 가입한 활성 계정 수(팀 포함)") int users, int teamUsers) {
    }

    @Schema(name = "AdminSubscribers", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Subscribers(OffsetDateTime generatedAt, List<Subscriber> subscriptions, List<Grant> grants,
            LaunchWeek launchWeek) {
    }

    @Operation(summary = "Subscribers", operationId = "subscribers_v2_admin_subscribers_get", tags = "admin",
            description = "구독 장부 전부(만료 포함)와 카드 없이 준 Pro 기간, 출시 주간 Pro 인원. team_actors(쉼표로 이은 "
                    + "가명 8자리)와 팀 이메일 목록에 걸리는 계정은 is_team. 이메일·user id·카드 정보는 싣지 않는다.")
    @GetMapping("/subscribers")
    ResponseEntity<Subscribers> subscribers(
            @RequestParam(name = "team_actors", required = false) String rawTeamActors,
            @RequestHeader(name = "authorization", defaultValue = "") String authorization) {
        requireToken(authorization);
        List<String> teamActors = parseActors(rawTeamActors);
        Instant now = clock.instant();
        List<Subscriber> subscriptions = reader.subscriptions(teamEmails, teamActors).stream()
                .map(row -> new Subscriber(row.actor(), row.name(), row.nickname(), row.team(), at(row.signedUpAt()),
                        row.provider(),
                        plan(row),
                        row.amount(), row.status(),
                        BillingRules.pro(BillingRules.Status.of(row.status()), row.periodEnd(), now, row.provider()),
                        at(row.periodStart()), at(row.periodEnd()), at(row.canceledAt()), at(row.createdAt()),
                        row.paidAmount(), row.paidCount()))
                .toList();
        List<Grant> grants = reader.grants(teamEmails, teamActors).stream()
                .map(row -> new Grant(row.actor(), row.name(), row.nickname(), row.team(), row.reason(),
                        at(row.startsAt()), at(row.endsAt()),
                        now.isBefore(row.startsAt()) ? "scheduled" : now.isBefore(row.endsAt()) ? "active" : "ended"))
                .toList();
        BillingAdminReader.Headcount launch =
                reader.signedUpBefore(BillingRules.LAUNCH_WEEK_START, teamEmails, teamActors);
        LaunchWeek launchWeek = new LaunchWeek(at(BillingRules.LAUNCH_WEEK_START), at(BillingRules.LAUNCH_WEEK_END),
                !now.isBefore(BillingRules.LAUNCH_WEEK_START) && now.isBefore(BillingRules.LAUNCH_WEEK_END),
                launch.users(), launch.team());
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                .body(new Subscribers(at(now), subscriptions, grants, launchWeek));
    }

    /** 토스 구독은 장부의 요금제(SOMA-1068 웹 연 구독), 스토어 구독은 상품 ID 로 정한다. */
    static String plan(BillingAdminReader.SubscriptionRow row) {
        BillingRules.Plan plan = BillingRules.PROVIDER_TOSS.equals(row.provider())
                ? BillingRules.Plan.ofDb(row.plan())
                : BillingRules.Plan.ofStoreProduct(row.productId());
        return plan.db();
    }

    private static List<String> parseActors(String raw) {
        if (raw == null || raw.isBlank()) {
            return List.of();
        }
        return Arrays.stream(raw.split(","))
                .map(value -> value.strip().toLowerCase(Locale.ROOT))
                .filter(value -> ACTOR.matcher(value).matches())
                .distinct()
                .limit(MAX_ACTORS)
                .toList();
    }

    private static OffsetDateTime at(Instant instant) {
        return instant == null ? null : instant.atOffset(ZoneOffset.UTC);
    }

    private void requireToken(String authorization) {
        byte[] actual = authorization.getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(actual, expectedAuthorization)) {
            throw new ApiException(401, "Unauthorized");
        }
    }
}
