package com.acttub.actingapi.platform.observability;

import static org.assertj.core.api.Assertions.assertThat;

import io.sentry.Sentry;
import io.sentry.SentryOptions.BeforeSendCallback;
import io.sentry.spring.boot.jakarta.SentryAutoConfiguration;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/**
 * <b>DSN 이 없으면 Sentry 를 켜지 않는다</b>는 가드를 지킨다. 파이썬 원본의
 * {@code test_init_is_skipped_without_dsn} 에 대응한다.
 *
 * <p>이 가드가 없으면 테스트가 이벤트를 밖으로 쏜다. Spring 컨텍스트는 테스트마다 뜨므로
 * 파이썬의 {@code create_app} 과 같은 자리다.
 *
 * <p>가드가 실제로 작동함을 보이려면 <b>대조군이 필요하다</b> — DSN 을 줬을 때 켜지는 것을 함께
 * 단언하지 않으면, 설정이 통째로 빠져도 이 테스트는 초록으로 남는다.
 */
class SentryInitializationTest {

    /** 실재하지 않는 프로젝트다. SDK 가 켜지는지만 보고 이벤트는 만들지 않는다. */
    private static final String FAKE_DSN = "https://public@o0.ingest.sentry.io/0";

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(SentryAutoConfiguration.class))
            .withUserConfiguration(UrlScrubbingCallback.class);

    @AfterEach
    void closeSentry() {
        // Sentry 는 전역 상태다. 켜진 채로 두면 다음 테스트가 그 설정을 물려받는다.
        Sentry.close();
    }

    @Test
    void sdkStaysOffWithoutDsn() {
        runner.run(context -> assertThat(Sentry.isEnabled()).isFalse());
    }

    @Test
    void sdkStaysOffWhenDsnIsBlank() {
        // application.yml 의 ${SENTRY_DSN:} 이 만드는 상태이자, api.env 에 빈 값이 들어간 상태다.
        runner.withPropertyValues("sentry.dsn=").run(context -> assertThat(Sentry.isEnabled()).isFalse());
    }

    @Test
    void sdkStaysOffWhenDsnIsWhitespace() {
        // 파이썬은 .strip() 으로 걸러낸다. systemd EnvironmentFile 은 값의 공백을 보존하므로
        // 사람이 관리하는 api.env 에서 실제로 나올 수 있는 값이다.
        runner.withPropertyValues("sentry.dsn=   ").run(context -> assertThat(Sentry.isEnabled()).isFalse());
    }

    @Test
    void sdkTurnsOnWithDsnAndKeepsTheScrubbingCallback() {
        runner.withPropertyValues(
                        "sentry.dsn=" + FAKE_DSN,
                        "sentry.environment=test",
                        "sentry.release=abc123")
                .run(context -> {
                    assertThat(Sentry.isEnabled()).isTrue();
                    // 주소를 씻는 콜백이 실제로 물려 들어갔는지 본다. 빠지면 식별자가 그대로 나간다.
                    BeforeSendCallback beforeSend = Sentry.getCurrentScopes().getOptions().getBeforeSend();
                    assertThat(beforeSend).isInstanceOf(UrlScrubbingCallback.class);
                    assertThat(Sentry.getCurrentScopes().getOptions().getEnvironment()).isEqualTo("test");
                    assertThat(Sentry.getCurrentScopes().getOptions().getRelease()).isEqualTo("abc123");
                    assertThat(Sentry.getCurrentScopes().getOptions().isSendDefaultPii()).isFalse();
                });
    }

    @Test
    void testEnvironmentDoesNotCarryARealDsn() {
        // .env 나 셸이 DSN 을 들고 있으면 테스트가 실제로 이벤트를 보낼 수 있다.
        assertThat(System.getenv("SENTRY_DSN"))
                .as("테스트 환경에 SENTRY_DSN 이 설정돼 있어요 — 이벤트가 실제로 나갑니다")
                .isNullOrEmpty();
    }
}
