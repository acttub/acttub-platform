package com.acttub.actingapi.config;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.apache.commons.logging.Log;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.boot.logging.DeferredLogFactory;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

/**
 * 작업 디렉토리의 {@code .env} 를 읽어 환경변수처럼 쓴다. <b>로컬 개발 편의용이다.</b>
 *
 * <p>서버에서는 systemd 가 {@code EnvironmentFile=/etc/acttub/api.env} 로 주입하고 배포
 * 아티팩트에는 {@code .env} 가 들어가지 않으므로, 이 클래스는 <b>운영에서 아무 일도 하지
 * 않는다</b>(파일이 없으면 조용히 넘어간다).
 *
 * <p><b>이미 있는 값을 덮지 않는다.</b> {@code addLast} 로 넣으므로 실제 환경변수·시스템
 * 프로퍼티·{@code application.yml} 이 항상 이긴다. {@code .env} 는 아무도 주지 않았을 때의
 * 마지막 보루다.
 *
 * <p><b>테스트에서는 꺼진다.</b> {@code acttub.dotenv.enabled=false} 로 끄며 Gradle test
 * 태스크가 그 값을 박아 둔다. 이 가드가 없으면 로컬 {@code .env} 의 실 API 키가 테스트로
 * 새어들어, 스텁을 쓰는 줄 알았던 테스트가 진짜 호출을 하게 된다.
 *
 * <p>{@link DatabaseUrlEnvironmentPostProcessor} 가 {@code DATABASE_URL} 을 읽으므로 그보다
 * 먼저 돌아야 한다({@link #getOrder()}).
 */
public class DotenvEnvironmentPostProcessor implements EnvironmentPostProcessor, Ordered {

    static final String PROPERTY_SOURCE_NAME = "acttubDotenv";
    static final String ENABLED_PROPERTY = "acttub.dotenv.enabled";
    static final String FILE_NAME = ".env";

    private final Log log;

    /** Boot 가 이 생성자를 찾아 부른다. 로깅 시스템이 서기 전이라 지연 로거를 받는다. */
    public DotenvEnvironmentPostProcessor(DeferredLogFactory logFactory) {
        this.log = logFactory.getLog(DotenvEnvironmentPostProcessor.class);
    }

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        if (!environment.getProperty(ENABLED_PROPERTY, Boolean.class, true)) {
            return;
        }
        Path path = Path.of(FILE_NAME);
        if (!Files.isReadable(path)) {
            return;
        }

        Map<String, Object> values;
        try {
            values = parse(Files.readAllLines(path, StandardCharsets.UTF_8));
        } catch (IOException e) {
            log.warn(".env 를 읽지 못했습니다: " + e.getMessage());
            return;
        }
        if (values.isEmpty()) {
            return;
        }

        // addLast — 실제 환경변수가 이긴다. .env 는 비어 있는 자리만 채운다.
        environment.getPropertySources()
                .addLast(new MapPropertySource(PROPERTY_SOURCE_NAME, values));
        // 값은 절대 찍지 않는다. 무엇이 들어왔는지만 보인다.
        log.info(".env 에서 " + values.size() + "개 키를 읽었습니다: " + String.join(", ", values.keySet()));
    }

    /**
     * {@code KEY=VALUE} 를 읽는다. 파이썬 {@code python-dotenv} 가 같은 파일을 읽으므로 그쪽이
     * 받아들이는 형태만 다룬다 — 주석, 빈 줄, {@code export} 접두, 값을 감싼 따옴표.
     */
    static Map<String, Object> parse(List<String> lines) {
        Map<String, Object> values = new LinkedHashMap<>();
        for (String raw : lines) {
            String line = raw.strip();
            if (line.isEmpty() || line.startsWith("#")) {
                continue;
            }
            if (line.startsWith("export ")) {
                line = line.substring("export ".length()).strip();
            }
            int eq = line.indexOf('=');
            // '=' 가 없거나 키가 비면 버린다. 값에 '=' 가 있는 경우(JWT 등)는 첫 '=' 로만 가른다.
            if (eq <= 0) {
                continue;
            }
            String key = line.substring(0, eq).strip();
            String value = unquote(line.substring(eq + 1).strip());
            values.put(key, value);
        }
        return values;
    }

    private static String unquote(String value) {
        if (value.length() >= 2
                && ((value.startsWith("\"") && value.endsWith("\""))
                        || (value.startsWith("'") && value.endsWith("'")))) {
            return value.substring(1, value.length() - 1);
        }
        return value;
    }

    @Override
    public int getOrder() {
        // application.yml 로딩 이후, DatabaseUrlEnvironmentPostProcessor(LOWEST_PRECEDENCE) 이전.
        // 순서가 뒤집히면 .env 의 DATABASE_URL 을 그쪽이 보지 못한다.
        return Ordered.LOWEST_PRECEDENCE - 100;
    }
}
