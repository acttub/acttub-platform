package com.acttub.actingapi;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

/**
 * 서버 .env 견본({@code deploy/home/.env.example})에 서버가 정해야 하는 키가 모두 있다. 키 목록의 정본은 이 견본과 compose 다
 * (docs/deploy/DEPLOY-HOME.md §2).
 *
 * <p>견본에 있어야 하는 키는 기본값이 없는 키다. 빼면 기능이 꺼지거나 값이 비므로 서버마다 정해야 한다.
 * <ul>
 *   <li>api 가 .env 에서 읽는 키: {@code ${KEY}}·{@code ${KEY:}}, {@code matchIfMissing = true} 가 없는
 *       {@code @ConditionalOnProperty}, 이름을 글자로 넘겨 읽는 키({@code static final String} 상수, {@code getProperty("KEY")}
 *       같은 호출). 찾는 곳은 {@code src/main/java} 와 {@code application*.yml} 이다.</li>
 *   <li>compose 가 .env·release.env 에서 치환하는 키: {@code ${KEY}}·{@code ${KEY:-}}·{@code ${KEY:?…}}.</li>
 * </ul>
 * 비지 않은 기본값({@code ${KEY:값}}, {@code ${KEY:-값}}, 기본 켜짐 스위치)은 코드나 compose 의 그 자리가 정본이라 견본에
 * 없어도 된다. compose 의 api {@code environment} 가 직접 넣는 키는 api 쪽에서 세지 않는다. 컨테이너에는 compose 의 값이
 * 들어가고, 그 값이 읽는 키는 compose 쪽에서 센다.
 *
 * <p>일부러 견본에 두지 않는 키는 {@code env-example-exceptions.txt} 에 까닭과 함께 둔다. 그 키가 견본에 생기거나 더는
 * 위 규칙에 걸리지 않으면 그 줄을 지우라고 실패한다.
 */
class EnvExampleTest {

    /** Gradle 은 {@code apps/api} 에서 테스트를 돌린다. */
    private static final Path EXAMPLE = Path.of("../../deploy/home/.env.example");

    private static final Path COMPOSE = Path.of("../../deploy/home/compose.yml");

    private static final Path EXCEPTIONS = Path.of("src/test/resources/env-example-exceptions.txt");

    private static final Path JAVA_ROOT = Path.of("src/main/java/com/acttub/actingapi");

    private static final Path RESOURCES = Path.of("src/main/resources");

    private static final String ENV = "[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+";

    /** 묶음 2 가 없으면 기본값이 없고, {@code :} 뿐이면 빈 기본값이다. */
    private static final Pattern PLACEHOLDER = Pattern.compile("\\$\\{(" + ENV + ")(:[^}]*)?}");

    private static final Pattern CONDITION = Pattern.compile("@ConditionalOnProperty\\s*\\(([^)]*)\\)");

    private static final Pattern MATCH_IF_MISSING = Pattern.compile("matchIfMissing\\s*=\\s*true");

    private static final Pattern QUOTED = Pattern.compile("\"(" + ENV + ")\"");

    private static final Pattern CONSTANT = Pattern.compile("static\\s+final\\s+String\\s+\\w+\\s*=\\s*\"(" + ENV + ")\"\\s*;");

    private static final Pattern LOOKUP = Pattern.compile(
            "\\b(?:getProperty|getRequiredProperty|containsProperty|getenv|value)\\s*\\(\\s*(?:\\w+\\s*,\\s*)?\"(" + ENV + ")\"");

    /** {@code $$} 는 compose 가 치환하지 않는 글자 그대로의 {@code $} 다. 묶음 2 는 {@code -}·{@code :-}·{@code ?}·{@code :?} 다. */
    private static final Pattern COMPOSE_VARIABLE = Pattern.compile("(?<!\\$)\\$\\{([A-Z][A-Z0-9_]*)(?:(:?[-?])([^}]*))?}");

    private static final Pattern EXAMPLE_KEY = Pattern.compile("^#? ?([A-Z][A-Z0-9_]*)=");

    @Test
    void everyKeyWithoutADefaultIsInTheExample() throws IOException {
        Map<String, Set<String>> required = required();
        Set<String> example = exampleKeys();
        Map<String, String> exceptions = exceptions();

        Map<String, Set<String>> missing = new TreeMap<>(required);
        missing.keySet().removeAll(example);
        missing.keySet().removeAll(exceptions.keySet());

        assertThat(missing)
                .as("deploy/home/.env.example 에 없다(키=읽는 곳). 기본값이 없어 서버가 정해야 하는 키다 — 견본에 쓰임·기본값·비울 때를"
                        + " 적어 넣는다. 서버에 두지 않는 키면 env-example-exceptions.txt 에 까닭과 함께 둔다.")
                .isEmpty();
    }

    @Test
    void exceptionsAreStillNeeded() throws IOException {
        Map<String, Set<String>> required = required();
        Set<String> example = exampleKeys();

        for (var exception : exceptions().entrySet()) {
            String key = exception.getKey();
            assertThat(exception.getValue()).as("%s 의 까닭이 없다", key).isNotBlank();
            assertThat(required).as("%s 는 더 이상 견본이 필요한 키가 아니다 — env-example-exceptions.txt 에서 지운다", key)
                    .containsKey(key);
            assertThat(example).as("%s 가 견본에 있다 — env-example-exceptions.txt 에서 지운다", key).doesNotContain(key);
        }
    }

    /** 읽는 꼴마다 하나씩 잡혀야 한다. 경로나 정규식이 어긋나 아무것도 못 찾고 통과하는 일을 막는다. */
    @Test
    void everyReadingFormIsFound() throws IOException {
        Map<String, Kind> api = apiReads().reads();
        assertThat(api).containsEntry("ADMIN_OPS_EXCLUDE_EMAILS", Kind.NO_DEFAULT) // ${KEY:}
                .containsEntry("ACTTUB_SAMPLE_SCRIPT_MODEL", Kind.DEFAULT) // ${KEY:값}
                .containsEntry("ANALYSIS_WORKER_ENABLED", Kind.DEFAULT) // matchIfMissing = true
                .containsEntry("FLYWAY_BASELINE_ONLY", Kind.NO_DEFAULT) // @ConditionalOnProperty
                .containsEntry("GEMINI_TTS_API_KEY", Kind.NO_DEFAULT) // static final String
                .containsEntry("LANGFUSE_HOST", Kind.NO_DEFAULT); // value(environment, "KEY")

        Map<String, Kind> compose = composeVariables();
        assertThat(compose).containsEntry("JWT_SECRET", Kind.NO_DEFAULT) // ${KEY:?…}
                .containsEntry("S3_ENDPOINT", Kind.NO_DEFAULT) // ${KEY:-}
                .containsEntry("API_MEM_LIMIT", Kind.DEFAULT); // ${KEY:-값}
        assertThat(apiEnvironment()).contains("JWT_SECRET", "PRACTICE_REMINDER_ENABLED");
        assertThat(exampleKeys()).contains("POSTGRES_PASSWORD", "GEMINI_API_KEY", "API_IMAGE");
    }

    enum Kind {
        DEFAULT,
        NO_DEFAULT;

        Kind and(Kind other) {
            return this == NO_DEFAULT || other == NO_DEFAULT ? NO_DEFAULT : DEFAULT;
        }
    }

    record ApiReads(Map<String, Kind> reads, Map<String, Set<String>> files) {}

    /** 견본이 필요한 키와 그 키를 읽는 곳(파일 또는 compose.yml). 한 곳이라도 기본값 없이 읽으면 기본값이 없는 키다. */
    private static Map<String, Set<String>> required() throws IOException {
        Map<String, Set<String>> required = new TreeMap<>();
        ApiReads api = apiReads();
        Set<String> composeSets = apiEnvironment();
        api.reads().forEach((key, kind) -> {
            if (kind == Kind.NO_DEFAULT && !composeSets.contains(key)) {
                required.put(key, api.files().get(key));
            }
        });
        composeVariables().forEach((key, kind) -> {
            if (kind == Kind.NO_DEFAULT) {
                required.computeIfAbsent(key, k -> new TreeSet<>()).add("compose.yml");
            }
        });
        return required;
    }

    private static ApiReads apiReads() throws IOException {
        Map<String, Kind> reads = new TreeMap<>();
        Map<String, Set<String>> files = new TreeMap<>();
        List<Path> sources;
        try (Stream<Path> java = Files.walk(JAVA_ROOT); Stream<Path> resources = Files.list(RESOURCES)) {
            sources = Stream.concat(
                            java.filter(path -> path.toString().endsWith(".java")),
                            resources.filter(path -> path.getFileName().toString().matches("application.*\\.ya?ml")))
                    .sorted()
                    .toList();
        }
        for (Path source : sources) {
            String text = Files.readString(source, StandardCharsets.UTF_8);
            String file = (source.startsWith(JAVA_ROOT) ? JAVA_ROOT.relativize(source) : source.getFileName()).toString();
            Map<String, Kind> found = new TreeMap<>();
            Matcher placeholder = PLACEHOLDER.matcher(text);
            while (placeholder.find()) {
                String defaultValue = placeholder.group(2);
                found.merge(placeholder.group(1),
                        defaultValue == null || defaultValue.length() == 1 ? Kind.NO_DEFAULT : Kind.DEFAULT, Kind::and);
            }
            Matcher condition = CONDITION.matcher(text);
            while (condition.find()) {
                Kind kind = MATCH_IF_MISSING.matcher(condition.group(1)).find() ? Kind.DEFAULT : Kind.NO_DEFAULT;
                Matcher name = QUOTED.matcher(condition.group(1));
                while (name.find()) {
                    found.merge(name.group(1), kind, Kind::and);
                }
            }
            for (Pattern byName : List.of(CONSTANT, LOOKUP)) {
                Matcher name = byName.matcher(text);
                while (name.find()) {
                    found.merge(name.group(1), Kind.NO_DEFAULT, Kind::and);
                }
            }
            found.forEach((key, kind) -> {
                reads.merge(key, kind, Kind::and);
                files.computeIfAbsent(key, k -> new TreeSet<>()).add(file);
            });
        }
        return new ApiReads(reads, files);
    }

    /** compose 의 api {@code environment} 가 넣는 이름. 이 키의 값은 .env 가 아니라 compose 가 정한다. */
    @SuppressWarnings("unchecked")
    private static Set<String> apiEnvironment() throws IOException {
        Map<String, Object> services = (Map<String, Object>) compose().get("services");
        Map<String, Object> api = (Map<String, Object>) services.get("api");
        return new TreeSet<>(((Map<String, Object>) api.get("environment")).keySet());
    }

    /** compose 가 치환하는 이름. 주석은 YAML 로 읽으며 빠진다. */
    private static Map<String, Kind> composeVariables() throws IOException {
        Map<String, Kind> variables = new TreeMap<>();
        for (String scalar : scalars(compose())) {
            Matcher variable = COMPOSE_VARIABLE.matcher(scalar);
            while (variable.find()) {
                String operator = variable.group(2);
                boolean hasDefault = operator != null && operator.endsWith("-") && !variable.group(3).isEmpty();
                variables.merge(variable.group(1), hasDefault ? Kind.DEFAULT : Kind.NO_DEFAULT, Kind::and);
            }
        }
        return variables;
    }

    private static Map<String, Object> compose() throws IOException {
        return new Yaml().load(Files.readString(COMPOSE, StandardCharsets.UTF_8));
    }

    private static List<String> scalars(Object node) {
        if (node instanceof Map<?, ?> map) {
            return map.entrySet().stream()
                    .flatMap(entry -> Stream.concat(scalars(entry.getKey()).stream(), scalars(entry.getValue()).stream()))
                    .toList();
        }
        if (node instanceof List<?> list) {
            return list.stream().flatMap(item -> scalars(item).stream()).toList();
        }
        return node == null ? List.of() : List.of(node.toString());
    }

    /** 주석 처리된 줄({@code #KEY=})과 release.env 설명 줄({@code # KEY=})도 견본의 키다. */
    private static Set<String> exampleKeys() throws IOException {
        return Files.readAllLines(EXAMPLE, StandardCharsets.UTF_8).stream()
                .map(EXAMPLE_KEY::matcher)
                .filter(Matcher::find)
                .map(matcher -> matcher.group(1))
                .collect(Collectors.toCollection(TreeSet::new));
    }

    /** 줄 모양은 {@code <키> <까닭>} 이다. {@code #} 줄과 빈 줄은 건너뛴다. */
    private static Map<String, String> exceptions() throws IOException {
        Map<String, String> exceptions = new TreeMap<>();
        for (String line : Files.readAllLines(EXCEPTIONS, StandardCharsets.UTF_8)) {
            String trimmed = line.strip();
            if (trimmed.isEmpty() || trimmed.startsWith("#")) {
                continue;
            }
            String[] parts = trimmed.split("\\s+", 2);
            exceptions.put(parts[0], parts.length > 1 ? parts[1] : "");
        }
        return exceptions;
    }
}
