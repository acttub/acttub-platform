package com.acttub.actingapi.platform.health;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.context.PropertyPlaceholderAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.ApplicationContext;
import org.springframework.core.env.SystemEnvironmentPropertySource;

/**
 * {@code /health} 의 {@code commit} 이 <b>배포가 실제로 주는 값</b>에서 파이썬 정본과 같은
 * 문자열이 되는지 본다({@code app.py:health} 의 {@code RENDER_GIT_COMMIT[:7]}).
 *
 * <p>{@link HealthAndBootIT} 는 이 필드를 <b>미설정 경로에서만</b> 본다 —
 * {@code commit == "unknown"}. 그런데 배포가 넣는 것은 40자 SHA 이므로
 * ({@code deploy/ssm-deploy.sh} 의 {@code be-java} drop-in, {@code SOMA-401})
 * 자르기가 도는 경로는 어느 테스트도 지나지 않았다. 변수 이름이 갈려도 그쪽은 초록으로
 * 남는다 — 미설정과 이름 오타가 같은 답({@code "unknown"})을 내기 때문이다.
 *
 * <p>⚠ <b>응답을 맞대는 검사로는 이 자리를 볼 수 없다.</b> 커밋 해시는 뜬 빌드마다 다른 것이
 * 정상이라 어떤 대조도 값을 고정할 수 없다(사라진 계약 하네스도 이 키를 마스킹했다). 그래서
 * <b>조용히 갈릴 수 있는 자리</b>이고, 여기서 못박아 둔다.
 *
 * <p>배포가 주는 것은 프로퍼티가 아니라 systemd {@code Environment=} 이므로 값을
 * {@link SystemEnvironmentPropertySource} 로 심는다 — OS 환경변수 자체는 프로세스 안에서
 * 바꿀 수 없어서, 배포가 실제로 쓰는 것과 <b>같은 종류의 소스</b>를 재현하는 것이 여기서
 * 갈 수 있는 가장 가까운 자리다. {@code @Value} 해석은 실제로 거친다.
 */
class HealthCommitTest {

    /** 배포가 넣는 값의 실제 모양이다 — {@code github.sha} 는 언제나 40자다. */
    private static final String FULL_SHA = "11481a9c0ffee1234567890abcdef1234567890a";

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(PropertyPlaceholderAutoConfiguration.class))
            .withUserConfiguration(HealthController.class);

    @Test
    void fortyCharacterShaIsCutToSevenLikePython() {
        withCommit(FULL_SHA).run(context -> assertThat(commitOf(context)).isEqualTo("11481a9"));
    }

    @Test
    void missingVariableStaysUnknown() {
        // 파이썬의 기본값과 같아야 한다. 하필 "unknown" 이 정확히 7자라 자르기에 걸리지 않는다.
        runner.run(context -> assertThat(commitOf(context)).isEqualTo("unknown"));
    }

    @Test
    void shorterThanSevenIsLeftAlone() {
        // 파이썬은 [:7] 이라 짧은 값을 그대로 낸다. 자바의 length() 분기가 같은 답을 내는지 본다.
        withCommit("abc").run(context -> assertThat(commitOf(context)).isEqualTo("abc"));
    }

    @Test
    void exactlySevenIsLeftAlone() {
        // 경계다. substring(0, 7) 과 length() > 7 이 어긋나면 여기서 드러난다.
        withCommit("1234567").run(context -> assertThat(commitOf(context)).isEqualTo("1234567"));
    }

    @Test
    void blankValueDoesNotFallBackToUnknown() {
        // 사람이 관리하는 /etc/acttub/api.env 에 빈 값이 들어간 상태다. 파이썬
        // os.environ.get("X", "unknown") 은 빈 문자열을 그대로 내므로("" 는 미설정이 아니다)
        // Spring 의 ${X:unknown} 도 같아야 한다 — 기본값은 키가 없을 때만 쓰인다.
        //
        // 🔎 배포 스크립트의 `${RELEASE:-unknown}` 과 혼동하지 않는다. 그쪽은 셸이라 빈 값도
        // unknown 으로 바꾸므로 drop-in 에서는 이 상태가 나올 수 없다. 여기는 사람이 넣은
        // 값이 그대로 들어오는 자바 자리이고, 두 층의 규칙이 서로 다르다.
        withCommit("").run(context -> assertThat(commitOf(context)).isEmpty());
    }

    @Test
    void testEnvironmentDoesNotCarryACommit() {
        // 셸이나 CI 가 이 이름을 들고 있으면 위의 미설정 케이스가 조용히 다른 것을 보게 된다.
        assertThat(System.getenv("RENDER_GIT_COMMIT"))
                .as("테스트 환경에 RENDER_GIT_COMMIT 이 설정돼 있어요 — 미설정 경로를 확인할 수 없습니다")
                .isNullOrEmpty();
    }

    /** systemd 가 준 환경변수를 흉내낸다 — 프로퍼티 맵이 아니라 환경변수 소스로 심는다. */
    private ApplicationContextRunner withCommit(String value) {
        return runner.withInitializer(context -> context.getEnvironment().getPropertySources()
                .addFirst(new SystemEnvironmentPropertySource(
                        "test-systemd-environment", Map.of("RENDER_GIT_COMMIT", value))));
    }

    private static String commitOf(ApplicationContext context) {
        return context.getBean(HealthController.class).health().commit();
    }
}
