package com.acttub.actingapi.feature.billing.app;

import java.time.Instant;
import java.util.List;

/**
 * ops 구독 화면(SOMA-963)이 읽는 장부. 사람은 가명(md5(user_id) 앞 8자리)·프로필 이름·닉네임으로만 싣고
 * 이메일·user id·카드·결제 키는 싣지 않는다. 팀 판정은 팀 이메일 목록과 팀 배우 가명 목록 둘 중 하나에 걸리면 팀이다.
 */
public interface BillingAdminReader {

    record SubscriptionRow(
            String actor,
            String name,
            String nickname,
            boolean team,
            Instant signedUpAt,
            String provider,
            String productId,
            long amount,
            String status,
            Instant periodStart,
            Instant periodEnd,
            Instant canceledAt,
            Instant createdAt,
            long paidAmount,
            int paidCount) {
    }

    record GrantRow(
            String actor,
            String name,
            String nickname,
            boolean team,
            String reason,
            Instant startsAt,
            Instant endsAt) {
    }

    /** 활성 계정 수와 그중 팀 계정 수. */
    record Headcount(int users, int team) {
    }

    /** 구독 장부 전부(만료 포함), 최근 구독 순. */
    List<SubscriptionRow> subscriptions(List<String> teamEmails, List<String> teamActors);

    /** 카드 없이 준 Pro 기간(billing_pro_grants) 전부, 최근 끝나는 순. */
    List<GrantRow> grants(List<String> teamEmails, List<String> teamActors);

    /** cutoff 전에 가입한 활성 계정 수 — 출시 주간 Pro 를 받는 사람 수. */
    Headcount signedUpBefore(Instant cutoff, List<String> teamEmails, List<String> teamActors);
}
