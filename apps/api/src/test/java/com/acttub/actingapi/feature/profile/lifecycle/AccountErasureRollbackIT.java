package com.acttub.actingapi.feature.profile.lifecycle;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountErasure;
import com.acttub.actingapi.feature.auth.app.AccountErasureSequence;
import com.acttub.actingapi.feature.auth.app.AccountErasureStep;
import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.profile.lifecycle.AccountLifecycleSeed.Identity;
import com.acttub.actingapi.platform.security.AccountSecrets;
import com.acttub.actingapi.support.FakeObjectStorage;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.StubProviders;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 계정을 닫는 일은 한 트랜잭션이다. 자기 몫을 지우는 구현({@link AccountErasure}) 하나가 실패하면 앞서 다른 구현이 지운 것과
 * 계정 상태까지 전부 되돌아간다 (ADR-040, apps/api/CONTRACT.md §6-8).
 *
 * <p>구현이 자기 트랜잭션으로 따로 커밋하면 여기서 드러난다. 실패 앞뒤의 DB 전체를 견준다({@link DatabaseChanges}).
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
@Import({StubProviders.class, MutableClock.Fixture.class, FakeObjectStorage.Fixture.class, RecordingFailureReporter.Fixture.class})
class AccountErasureRollbackIT {

    private static final Instant NOW = Instant.parse("2026-11-20T03:00:00Z");

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    JwtService jwt;

    @Autowired
    MutableClock clock;

    @Autowired
    AccountSecrets secrets;

    @Autowired
    AccountErasureSequence sequence;

    /** {@code auth} 의 구현. 맡은 자리가 순서의 뒤쪽에 흩어져 있어, 여기서 던지면 앞의 여러 기능이 이미 지운 뒤다. */
    @MockitoSpyBean(name = "postgresAuthAccountErasure")
    AccountErasure authErasure;

    @MockitoSpyBean(name = "postgresPortfolioAccountErasure")
    AccountErasure portfolioErasure;

    @MockitoSpyBean(name = "postgresTransferAccountErasure")
    AccountErasure transferErasure;

    @MockitoSpyBean(name = "postgresPushAccountErasure")
    AccountErasure pushErasure;

    @MockitoSpyBean(name = "postgresProfileAccountErasure")
    AccountErasure profileErasure;

    @MockitoSpyBean(name = "postgresCommunityAccountErasure")
    AccountErasure communityErasure;

    @MockitoSpyBean(name = "postgresVideoAccountErasure")
    AccountErasure videoErasure;

    @MockitoSpyBean(name = "postgresBillingAccountErasure")
    AccountErasure billingErasure;

    @MockitoSpyBean(name = "postgresFeedbackAccountErasure")
    AccountErasure feedbackErasure;

    private AccountLifecycleSeed seed;

    @BeforeEach
    void setUp(org.junit.jupiter.api.TestInfo test) {
        jdbc.execute("TRUNCATE TABLE users,consent_documents,ads,support_inquiries,practice_migration_entries RESTART IDENTITY CASCADE");
        clock.set(NOW);
        seed = new AccountLifecycleSeed(jdbc, secrets, NOW, test.getDisplayName());
        seed.shared();
    }

    @ParameterizedTest(name = "{0} 자리에서 실패")
    @EnumSource(value = AccountErasureStep.class, names = {
        "VIDEO_FILES", "PRACTICE_FEEDBACK", "COMMUNITY_IMAGES", "SIGNUP_ATTRIBUTION", "BILLING", "DISCOVERY_ANSWER",
        "IDENTITIES", "BILLING_CUSTOMER", "EMAIL", "PROFILE", "PORTFOLIO", "TRANSFER_CODES", "SESSIONS", "PUSH"
    })
    @DisplayName("구현 하나가 예외를 던지면 탈퇴 전체가 되돌아간다: 계정은 활성 그대로이고 어느 표도 달라지지 않는다")
    void aFailingOwnerRollsTheWholeWithdrawalBack(AccountErasureStep failing) throws Exception {
        UUID self = seed.full("본인", Identity.MEMBER, "declined");
        seed.full("남", Identity.MEMBER, "granted");
        seed.cross("본인", "남");
        seed.cross("남", "본인");
        AccountErasure owner = ownerOf(failing);
        doThrow(new IllegalStateException("erasure failed")).when(owner).erase(eq(failing), any());
        DatabaseChanges changes = new DatabaseChanges(jdbc);
        DatabaseChanges.Snapshot before = changes.read();

        var response = mvc.perform(delete("/v2/me").header("Authorization", "Bearer " + jwt.issueAccessToken(self).value()))
                .andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(500);
        verify(owner).erase(eq(failing), any());
        assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id=?", String.class, self)).isEqualTo("active");
        assertThat(changes.read()).as("앞선 자리들이 지운 것도 남지 않는다").isEqualTo(before);
    }

    /** 그 자리를 맡은 구현. 주인에게 옮긴 자리만 있다 — 옮기지 않은 자리는 빈이 따로 없어 여기서 던지게 할 수 없다. */
    private AccountErasure ownerOf(AccountErasureStep step) {
        return switch (step) {
            case IDENTITIES, EMAIL, SESSIONS -> authErasure;
            case PORTFOLIO -> portfolioErasure;
            case TRANSFER_CODES -> transferErasure;
            case PUSH -> pushErasure;
            case SIGNUP_ATTRIBUTION, DISCOVERY_ANSWER, PROFILE -> profileErasure;
            case COMMUNITY_IMAGES -> communityErasure;
            case VIDEO_FILES -> videoErasure;
            case BILLING, BILLING_CUSTOMER -> billingErasure;
            case PRACTICE_FEEDBACK -> feedbackErasure;
            default -> throw new IllegalArgumentException("no spied owner for " + step);
        };
    }

    @Test
    @DisplayName("자료가 있는가: 계정과 함께 지워지는 것만 가진 계정은 없다고, 연습·리딩·챌린지·게시판 자료가 있는 계정은 있다고 답한다")
    void hasRecordsTellsHistoryFromWhatGoesWithTheAccount() {
        UUID light = seed.light("자료 없음", Identity.MEMBER, "granted");
        UUID full = seed.full("자료 있음", Identity.MEMBER, "granted");

        assertThat(sequence.hasRecords(light)).isFalse();
        assertThat(sequence.hasRecords(full)).isTrue();
        // 주인마다의 답. 게시판 자료와 정리 장부의 일은 계정 행을 지우지 못하게 하고, 나머지 주인의 표는 계정과 함께 지워진다.
        assertThat(communityErasure.hasRecords(light)).isFalse();
        assertThat(communityErasure.hasRecords(full)).isTrue();
        assertThat(profileErasure.hasRecords(light)).isFalse();
        assertThat(profileErasure.hasRecords(full)).isTrue();
        assertThat(videoErasure.hasRecords(light)).isFalse();
        assertThat(videoErasure.hasRecords(full)).isTrue();
        for (AccountErasure withHistory : List.of(feedbackErasure)) {
            assertThat(withHistory.hasRecords(light)).isFalse();
            assertThat(withHistory.hasRecords(full)).isTrue();
        }
        for (AccountErasure accountOnly : List.of(authErasure, portfolioErasure, transferErasure, pushErasure, billingErasure)) {
            assertThat(accountOnly.hasRecords(full)).isFalse();
        }
    }
}
