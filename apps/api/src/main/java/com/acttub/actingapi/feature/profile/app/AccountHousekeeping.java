package com.acttub.actingapi.feature.profile.app;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.stereotype.Service;

/**
 * 계정 영역에서 매일 도는 일 (SOMA-528 계정 스펙 「정해진 시각에 도는 일」).
 *
 * <ol>
 *   <li>만료되거나 폐기된 지 30일 지난 리프레시 토큰 행을 지운다. 그 전까지는 소진된 토큰의 재사용 탐지와
 *       문제 추적에 쓴다 (account.login).</li>
 *   <li>마지막 활동 30일 지난 게스트를 <b>탈퇴와 같은 절차로</b> 파기한다 (account.guest). 옮겨진 게스트는
 *       이미 닫혀 있어 대상이 아니다.</li>
 *   <li>탈퇴 3년 지난 계정의 신원 해시 행과, 보관 동의로 남겨 두었던 영상 객체를 파기한다
 *       (account.withdraw, ADR-029). 객체 삭제는 탈퇴와 같은 정리 장부로 간다.</li>
 *   <li>7일 지난 해제 재시도를 치운다 — {@link AccountCleanup#runDue} 가 하는 일이고 5분마다도 돈다.</li>
 *   <li>쓰였거나 시한이 지난 지 30일 지난 이관 코드 행을 지운다. 쓰인 코드는 "옮겨진 게스트"의 표식이라
 *       그 게스트의 리프레시 토큰이 살 수 있는 30일 동안은 남겨야 한다.</li>
 * </ol>
 *
 * <p>한 가지가 실패해도 나머지는 돈다. 실패는 보고하고 다음 날 다시 시도한다 — 모두 멱등이다.
 */
@Service
public class AccountHousekeeping {
    static final Duration TOKEN_RETENTION = Duration.ofDays(30);
    static final Duration GUEST_IDLE = Duration.ofDays(30);
    static final Duration TRANSFER_CODE_RETENTION = Duration.ofDays(30);
    static final int IDENTITY_HASH_YEARS = 3;

    private final ProfileRepository profiles;
    private final ProfileService accounts;
    private final AccountCleanup cleanup;
    private final FailureReporter failureReporter;
    private final Clock clock;

    public AccountHousekeeping(
            ProfileRepository profiles,
            ProfileService accounts,
            AccountCleanup cleanup,
            FailureReporter failureReporter,
            Clock clock) {
        this.profiles = profiles;
        this.accounts = accounts;
        this.cleanup = cleanup;
        this.failureReporter = failureReporter;
        this.clock = clock;
    }

    public void runDaily() {
        Instant now = clock.instant();
        step("refreshTokens", () -> profiles.deleteStaleRefreshTokens(now.minus(TOKEN_RETENTION)));
        step("idleGuests", () -> {
            for (UUID guest : profiles.idleGuests(now.minus(GUEST_IDLE))) {
                step("idleGuest", () -> accounts.withdraw(guest));
            }
        });
        // 3년은 달력의 3년이다. 한국 시간의 날짜로 센다(탈퇴 시각의 3년 뒤 같은 시각).
        Instant threeYearsAgo = now.atZone(ProfileService.SEOUL).minusYears(IDENTITY_HASH_YEARS).toInstant();
        step("retention", () -> cleanup.attempt(profiles.purgeRetained(threeYearsAgo, now)));
        step("cleanup", cleanup::runDue);
        step("transferCodes", () -> profiles.deleteStaleTransferCodes(now.minus(TRANSFER_CODE_RETENTION)));
    }

    private void step(String name, Runnable work) {
        try {
            work.run();
        } catch (RuntimeException failure) {
            failureReporter.report(failure, new FailureContext("AccountHousekeeping." + name));
        }
    }
}
