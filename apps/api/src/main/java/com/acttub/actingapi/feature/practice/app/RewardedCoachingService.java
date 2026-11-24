package com.acttub.actingapi.feature.practice.app;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.practice.app.CoachingRewardRepository.NewReward;
import com.acttub.actingapi.feature.practice.domain.PracticeRules;

/**
 * 무료 코칭 한도 뒤 「광고 보고 1회 더」(SOMA-1067).
 *
 * <p>무료 한도가 걸린 사람({@link CoachingPlan#freeLimited} — 한도 플래그 켜짐, Pro 아님, 유예 아님)이 오늘 회차를 다 쓰면 앱이
 * AdMob 보상형 광고를 띄운다. 광고를 끝까지 보면 AdMob 이 서버에 서명된 확인(SSV)을 보내고, 서명이 맞으면
 * {@link #grant} 가 그날 한도에 1회를 더한다. 앱은 광고를 띄울 때 만든 요청 id 로 {@link #granted} 를 물어 지급을 확인한다.
 *
 * <p>스위치({@code COACHING_REWARDED_AD_ENABLED}, 기본 false)가 꺼져 있으면 아무것도 지급하지 않고, 한도에 더하는 값도 0 이라
 * 기존 한도 계산이 그대로다. 하루 상한은 {@code COACHING_REWARDED_AD_DAILY_LIMIT}(기본 1).
 */
public class RewardedCoachingService implements CoachingBonus {
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    /** AdMob transaction_id 는 짧은 영숫자다. 이상한 값을 PK 로 넣지 않는다. */
    private static final Pattern TRANSACTION_ID = Pattern.compile("[A-Za-z0-9._:-]{1,128}");

    private final boolean enabled;
    private final int dailyLimit;
    private final CoachingPlan plan;
    private final CoachingRewardRepository rewards;
    private final Clock clock;

    public RewardedCoachingService(boolean enabled, int dailyLimit, CoachingPlan plan, CoachingRewardRepository rewards,
            Clock clock) {
        this.enabled = enabled && dailyLimit > 0;
        this.dailyLimit = dailyLimit;
        this.plan = plan;
        this.rewards = rewards;
        this.clock = clock;
    }

    public boolean enabled() {
        return enabled;
    }

    @Override
    public int extraSessions(UUID userId, Instant since) {
        if (!enabled || userId == null) {
            return 0;
        }
        return rewards.grantedSince(userId, since);
    }

    /**
     * 지금 「광고 보고 1회 더」를 보일까 — 스위치가 켜져 있고, 회원이고, 무료 한도가 걸리고, 오늘 상한이 남았고, 오늘 회차를
     * (받은 보상분까지) 다 썼을 때만 true.
     */
    public boolean available(UUID userId, boolean guest) {
        if (!enabled || guest || userId == null || !plan.freeLimited(userId)) {
            return false;
        }
        Instant midnight = midnight();
        int granted = rewards.grantedSince(userId, midnight);
        if (granted >= dailyLimit) {
            return false;
        }
        return rewards.sessionsSince(userId, midnight) >= PracticeRules.FREE_DAILY_COACHING_SESSIONS + granted;
    }

    /**
     * 서명을 확인한 AdMob 콜백의 지급. 값이 이상하거나 한도 비대상(Pro 등)이면 지급하지 않는다. 같은 시청이 다시 와도 한 번만
     * 지급한다.
     *
     * @param userIdValue AdMob {@code user_id} — 앱이 넣은 회원 id
     * @param requestIdValue AdMob {@code custom_data} — 앱이 만든 1회용 요청 id
     */
    public Outcome grant(String userIdValue, String requestIdValue, String transactionId) {
        if (!enabled) {
            return Outcome.IGNORED;
        }
        UUID userId = uuid(userIdValue);
        UUID requestId = uuid(requestIdValue);
        if (userId == null || requestId == null || transactionId == null || !TRANSACTION_ID.matcher(transactionId).matches()) {
            return Outcome.IGNORED;
        }
        if (!plan.freeLimited(userId)) {
            return Outcome.IGNORED;
        }
        return switch (rewards.grant(new NewReward(transactionId, userId, requestId), midnight(), dailyLimit, clock.instant())) {
            case GRANTED -> Outcome.GRANTED;
            case DUPLICATE -> Outcome.DUPLICATE;
            case CAPPED -> Outcome.CAPPED;
            case NO_USER -> Outcome.IGNORED;
        };
    }

    /** 이 요청 id 로 오늘 1회가 더해졌는가. 스위치가 꺼져 있으면 false. */
    public boolean granted(UUID userId, UUID requestId) {
        if (!enabled || userId == null || requestId == null) {
            return false;
        }
        return rewards.granted(userId, requestId);
    }

    private Instant midnight() {
        return LocalDate.now(clock.withZone(SEOUL)).atStartOfDay(SEOUL).toInstant();
    }

    private static UUID uuid(String value) {
        if (value == null || value.length() != 36) {
            return null;
        }
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException invalid) {
            return null;
        }
    }

    /** 콜백 응답의 {@code result} 값이기도 하다. */
    public enum Outcome {
        GRANTED,
        DUPLICATE,
        CAPPED,
        /** 값이 이상하거나 지급 대상이 아니다. */
        IGNORED
    }
}
