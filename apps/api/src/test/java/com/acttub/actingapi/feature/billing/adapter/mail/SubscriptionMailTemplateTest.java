package com.acttub.actingapi.feature.billing.adapter.mail;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;

import com.acttub.actingapi.feature.billing.app.BillingMailer.PaidMail;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class SubscriptionMailTemplateTest {
    private static PaidMail mail(boolean first, String name) {
        return new PaidMail("actor@example.com", name, first, "pro-first-97ea0560", 3900, "하나", "53183800****5678",
                Instant.parse("2026-11-01T06:52:12Z"), Instant.parse("2026-11-01T06:52:12Z"),
                Instant.parse("2026-12-01T06:52:12Z"));
    }

    @Test
    @DisplayName("첫 결제 메일은 고른 시안의 제목·인사·결제 정보·해지·환불·사업자 정보를 모두 담는다")
    void firstPaymentMailCarriesTheContract() {
        SubscriptionMailTemplate.Rendered r = SubscriptionMailTemplate.render(mail(true, "QAtest"));
        assertThat(r.subject()).isEqualTo("Pro 구독을 시작했어요 · 3,900원 결제 완료");
        assertThat(r.html()).contains("QAtest님, Pro를 시작했어요", "오늘부터 아래 기능을 제한 없이 쓸 수 있어요.",
                "ACTTUB Pro 월 구독", "3,900원 (부가세 포함)", "하나카드 ····5678", "2026.11.01 15:52",
                "2026.11.01 ~ 2026.11.30", "2026.12.01 · 3,900원", "pro-first-97ea0560",
                "https://acttub.com/account", "https://acttub.com/refund", "796-11-03104", "2026-서울동대문-1884",
                "다음 결제일은 12월 1일이에요.");
        assertThat(r.text()).contains("다음 결제일: 2026.12.01 · 3,900원", "해지·환불 정책: https://acttub.com/refund");
    }

    @Test
    @DisplayName("자동결제 메일은 갱신 제목을 쓰고, 이름이 없으면 이름 없이 인사한다")
    void renewalAndMissingName() {
        SubscriptionMailTemplate.Rendered r = SubscriptionMailTemplate.render(mail(false, null));
        assertThat(r.subject()).isEqualTo("Pro 구독이 갱신됐어요 · 3,900원 결제 완료");
        assertThat(r.html()).contains(">Pro 구독이 갱신됐어요</h1>", "이번 기간에도").doesNotContain("null");
    }

    @Test
    @DisplayName("닉네임은 HTML 로 해석되지 않게 이스케이프한다")
    void escapesUserText() {
        SubscriptionMailTemplate.Rendered r = SubscriptionMailTemplate.render(mail(true, "<b>x</b>&\""));
        assertThat(r.html()).contains("&lt;b&gt;x&lt;/b&gt;&amp;&quot;님").doesNotContain("<b>x</b>");
    }

    @Test
    void cardLabel() {
        assertThat(SubscriptionMailTemplate.card("신한카드", "43301234****123*")).isEqualTo("신한카드 ····123*");
        assertThat(SubscriptionMailTemplate.card(null, null)).isEqualTo("카드");
    }
}
