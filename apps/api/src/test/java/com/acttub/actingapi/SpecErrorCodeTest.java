package com.acttub.actingapi;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.MatchResult;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 스펙의 오류 코드와 코드가 내는 오류가 같다. 기능의 오류 코드는 스펙이 정본이다(루트 CLAUDE.md 「조건부 정본」).
 *
 * <ul>
 *   <li>스펙이 상태 코드와 함께 적은 오류({@code `video_not_ready` 422}, {@code 422 sample_script_invalid_options})는 코드에
 *       같은 상태·같은 코드의 {@code ApiException} 이 있다. 코드를 지우거나 상태를 바꾸면 스펙도 고친다.</li>
 *   <li>코드가 내는 오류 코드는 어느 스펙엔가 나온다. 새 오류를 더하면 그 기능 스펙의 「입력·출력」이나 규칙에 적는다.
 *       아직 스펙이 없는 것은 {@code spec-error-code-exceptions.txt} 에 까닭과 함께 두고 줄을 더하지 않는다.</li>
 * </ul>
 *
 * <p>코드는 밑줄이 든 소문자 낱말만 센다. {@code request is still processing} 같은 문장형 오류와 밑줄 없는 낱말은 글 속 낱말과
 * 가를 수 없어 세지 않는다. 오류가 나는 자리를 하나하나 세는 것은 {@code ErrorContractInventoryTest} 다.
 */
class SpecErrorCodeTest {

    /** Gradle 은 {@code apps/api} 에서 테스트를 돌린다. */
    private static final Path SPECS = Path.of("../../docs/specs");

    private static final Path JAVA_ROOT = Path.of("src/main/java");

    private static final Path EXCEPTIONS = Path.of("src/test/resources/spec-error-code-exceptions.txt");

    /** 예외 목록의 줄 수. 줄을 더하지 않는다 — 새 오류는 스펙에 적는다. 스펙을 채워 줄을 뺐으면 이 수도 내린다. */
    private static final int EXCEPTION_CEILING = 2;

    private static final String CODE = "[a-z][a-z0-9]*(?:_[a-z0-9]+)+";

    private static final Pattern CODE_THEN_STATUS = Pattern.compile("(?<![\\w`/.-])`?(" + CODE + ")`?\\s*([45]\\d\\d)(?!\\d)");

    private static final Pattern STATUS_THEN_CODE = Pattern.compile("(?<![\\d.])([45]\\d\\d)\\s+`?(" + CODE + ")`?");

    private static final Pattern WORD = Pattern.compile(CODE);

    /** {@code new ApiException(409, "x")}, {@code ApiException.external(502, "x", e)}, 그리고 {@code ApiErrorAdvice} 의 {@code body(503, "x")}. */
    private static final Pattern SITE = Pattern.compile(
            "(?:ApiException(?:\\.\\w+)?|\\bbody)\\(\\s*([45]\\d\\d)\\s*,\\s*\"(" + CODE + ")\"");

    private static final Pattern BLOCK_COMMENT = Pattern.compile("(?s)/\\*.*?\\*/");

    private static final Pattern LINE_COMMENT = Pattern.compile("(?m)^\\s*//.*$");

    @Test
    @DisplayName("스펙이 상태와 함께 적은 오류 코드를 코드가 그 상태로 낸다")
    void everyErrorInTheSpecsIsThrownWithThatStatus() {
        Set<String> thrown = sites().keySet();
        Map<String, Set<String>> missing = new TreeMap<>();
        specs().forEach((file, text) -> {
            for (String pair : documented(text)) {
                if (!thrown.contains(pair)) {
                    missing.computeIfAbsent(pair, key -> new TreeSet<>()).add(file);
                }
            }
        });
        assertThat(missing)
                .as("스펙의 「상태 코드」 → 그 상태로 그 코드를 내는 ApiException 이 없다. 코드를 지웠거나 상태를 바꿨으면 스펙을 고친다")
                .isEmpty();
    }

    @Test
    @DisplayName("코드가 내는 오류 코드가 어느 스펙엔가 나온다")
    void everyThrownErrorIsInASpec() {
        Set<String> words = new TreeSet<>();
        specs().values().forEach(text -> WORD.matcher(text).results().map(MatchResult::group).forEach(words::add));
        Map<String, String> exceptions = exceptions();

        Map<String, Set<String>> undocumented = new TreeMap<>();
        sites().forEach((pair, files) -> {
            String code = pair.substring(pair.indexOf(' ') + 1);
            if (!words.contains(code) && !exceptions.containsKey(code)) {
                undocumented.computeIfAbsent(pair, key -> new TreeSet<>()).addAll(files);
            }
        });
        assertThat(undocumented)
                .as("「상태 코드」 → 그 오류를 내는 파일. 스펙에 없는 오류다 — 그 기능 스펙의 「입력·출력」이나 규칙에 적는다")
                .isEmpty();

        Set<String> codes = new TreeSet<>();
        sites().keySet().forEach(pair -> codes.add(pair.substring(pair.indexOf(' ') + 1)));
        Set<String> stale = new TreeSet<>();
        exceptions.keySet().forEach(code -> {
            if (words.contains(code) || !codes.contains(code)) {
                stale.add(code);
            }
        });
        assertThat(stale).as("스펙에 적었거나 코드에서 사라진 오류다 — 예외 목록에서 지운다").isEmpty();
        assertThat(exceptions).as("예외 목록은 늘리지 않는다(EXCEPTION_CEILING)").hasSizeLessThanOrEqualTo(EXCEPTION_CEILING);
    }

    @Test
    @DisplayName("찾는 법이 실제 글꼴을 읽는다 — 0건이면 위 둘이 조용히 통과한다")
    void theScannersReadTheFormsThatActuallyOccur() {
        assertThat(documented("`video_not_ready` 422, 422 `sample_script_invalid_options`, 429 free_daily_coaching_limit"))
                .containsExactlyInAnyOrder("422 video_not_ready", "422 sample_script_invalid_options",
                        "429 free_daily_coaching_limit");
        assertThat(documented("200 `duplicate_script_id`, v2.422 `x_y`")).isEmpty();
        assertThat(sites()).hasSizeGreaterThan(100).containsKeys("422 video_not_ready", "503 storage_not_configured");
        assertThat(specs()).hasSizeGreaterThan(40);
    }

    /** 스펙 글 하나에서 「상태 코드」 쌍. */
    private static Set<String> documented(String text) {
        Set<String> pairs = new TreeSet<>();
        Matcher codeFirst = CODE_THEN_STATUS.matcher(text);
        while (codeFirst.find()) {
            pairs.add(codeFirst.group(2) + " " + codeFirst.group(1));
        }
        Matcher statusFirst = STATUS_THEN_CODE.matcher(text);
        while (statusFirst.find()) {
            pairs.add(statusFirst.group(1) + " " + statusFirst.group(2));
        }
        return pairs;
    }

    /** docs/specs 의 파일 → 글. */
    private static Map<String, String> specs() {
        Map<String, String> specs = new TreeMap<>();
        try (Stream<Path> files = Files.walk(SPECS)) {
            for (Path file : files.filter(path -> path.toString().endsWith(".md")).toList()) {
                specs.put(SPECS.relativize(file).toString(), Files.readString(file, StandardCharsets.UTF_8));
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return specs;
    }

    /** 「상태 코드」 → 그 오류를 내는 파일. 주석 안의 예시는 세지 않는다. */
    private static Map<String, Set<String>> sites() {
        Map<String, Set<String>> sites = new TreeMap<>();
        try (Stream<Path> files = Files.walk(JAVA_ROOT)) {
            for (Path file : files.filter(path -> path.toString().endsWith(".java")).toList()) {
                String source = Files.readString(file, StandardCharsets.UTF_8);
                source = LINE_COMMENT.matcher(BLOCK_COMMENT.matcher(source).replaceAll("")).replaceAll("");
                Matcher site = SITE.matcher(source);
                while (site.find()) {
                    sites.computeIfAbsent(site.group(1) + " " + site.group(2), key -> new TreeSet<>())
                            .add(file.getFileName().toString());
                }
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return sites;
    }

    /** 코드 → 까닭. 한 줄이 {@code <코드> <까닭>} 이고 {@code #} 줄은 설명이다. */
    private static Map<String, String> exceptions() {
        Map<String, String> exceptions = new TreeMap<>();
        try {
            for (String line : Files.readAllLines(EXCEPTIONS, StandardCharsets.UTF_8)) {
                if (line.isBlank() || line.startsWith("#")) {
                    continue;
                }
                String[] parts = line.split(" ", 2);
                assertThat(parts).as("줄 모양은 <코드> <까닭>: %s", line).hasSize(2);
                exceptions.put(parts[0], parts[1]);
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return exceptions;
    }
}
