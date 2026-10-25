package com.acttub.actingapi.feature.support.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.platform.web.ApiValidationException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class SupportInquiryServiceTest {

    private final List<SupportInquiryStore.NewInquiry> saved = new ArrayList<>();
    private final Instant now = Instant.parse("2026-10-25T00:00:00Z");
    private final SupportInquiryService service = new SupportInquiryService(
            new SupportInquiryStore() {
                @Override
                public void insert(NewInquiry inquiry, Instant at) {
                    saved.add(inquiry);
                }

                @Override
                public List<Inquiry> list(String status, int limit) {
                    return List.of();
                }
            },
            Clock.fixed(now, ZoneOffset.UTC));

    @Test
    @DisplayName("본문과 이메일은 앞뒤 공백을 걷어 저장하고 id·접수 시각을 돌려준다")
    void trimsAndStores() {
        UUID user = UUID.randomUUID();
        var accepted = service.submit("refund", "  a@b.co  ", "  환불은 어떻게 하나요?  ", user, "web/1.0");

        assertThat(accepted.createdAt()).isEqualTo(now);
        assertThat(saved).singleElement().satisfies(row -> {
            assertThat(row.id()).isEqualTo(accepted.id());
            assertThat(row.email()).isEqualTo("a@b.co");
            assertThat(row.body()).isEqualTo("환불은 어떻게 하나요?");
            assertThat(row.userId()).isEqualTo(user);
            assertThat(row.client()).isEqualTo("web/1.0");
        });
    }

    @Test
    @DisplayName("공백을 걷어 낸 본문이 10자 미만이거나 3000자 초과면 422(body 칸)")
    void rejectsBodyOutsideLengthRange() {
        assertThatThrownBy(() -> service.submit("bug", "a@b.co", "         9자입니다 ", null, null))
                .isInstanceOf(ApiValidationException.class);
        assertThatThrownBy(() -> service.submit("bug", "a@b.co", "가".repeat(3001), null, null))
                .isInstanceOf(ApiValidationException.class);
        service.submit("bug", "a@b.co", "가".repeat(10), null, null);
        service.submit("bug", "a@b.co", "가".repeat(3000), null, null);
        assertThat(saved).hasSize(2);
    }

    @Test
    @DisplayName("이메일 형식이 틀리거나 254자를 넘으면 422, 저장하지 않는다")
    void rejectsBadEmail() {
        for (String bad : List.of("plain", "a@b", "a b@c.com", "@c.com", "a@@c.com",
                "a".repeat(250) + "@b.co")) {
            assertThatThrownBy(() -> service.submit("other", bad, "충분히 긴 문의 본문입니다", null, null))
                    .as(bad).isInstanceOf(ApiValidationException.class);
        }
        assertThat(saved).isEmpty();
    }

    @Test
    @DisplayName("이모지는 코드 포인트로 센다 — 10자짜리 이모지 본문이 통과한다")
    void countsCodePoints() {
        service.submit("other", "a@b.co", "😀".repeat(10), null, null);
        assertThat(saved).hasSize(1);
    }
}
