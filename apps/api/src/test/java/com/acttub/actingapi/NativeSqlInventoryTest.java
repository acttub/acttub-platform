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
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;

/**
 * 네이티브 SQL 이 남은 자리를 목록({@code native-sql-files.txt})과 대조한다(apps/api/CONTRACT.md §5-9).
 *
 * <p>목록은 파일마다 주석 밖의 {@code createNativeQuery(}·{@code nativeQuery = true} 수를 적는다. 까닭이 없는 줄은 아직 JPA 로
 * 옮기지 않은 자리이고 그 합은 줄기만 한다({@link #PENDING_CEILING}). 옮기지 않기로 한 자리는 {@code 남김:} 뒤에 까닭을 적은
 * 줄이다 — 새 네이티브 SQL 은 까닭을 적어야 목록에 오른다.
 */
class NativeSqlInventoryTest {

    /** Gradle 은 {@code apps/api} 에서 테스트를 돌린다. */
    private static final Path JAVA_ROOT = Path.of("src/main/java/com/acttub/actingapi");

    private static final Path INVENTORY = Path.of("src/test/resources/native-sql-files.txt");

    /** 까닭 없이 남은 자리의 합. 영역을 옮겨 줄었으면 이 수도 같이 내린다. 늘리지 않는다. */
    private static final int PENDING_CEILING = 98;

    private static final Pattern NATIVE = Pattern.compile("createNativeQuery\\(|nativeQuery\\s*=\\s*true");

    private static final Pattern ROW = Pattern.compile("^(\\S+\\.java) ([1-9][0-9]*)(?: 남김: (\\S.*))?$");

    @Test
    void theListMatchesTheCode() throws IOException {
        Map<String, Integer> listed = new TreeMap<>();
        for (Row row : rows()) {
            listed.merge(row.file(), row.sites(), Integer::sum);
        }

        Map<String, Integer> inCode = sitesInCode();
        Map<String, String> differences = new TreeMap<>();
        Set<String> files = new TreeSet<>(listed.keySet());
        files.addAll(inCode.keySet());
        for (String file : files) {
            int expected = listed.getOrDefault(file, 0);
            int actual = inCode.getOrDefault(file, 0);
            if (expected != actual) {
                differences.put(file, "목록 " + expected + ", 코드 " + actual);
            }
        }

        assertThat(differences)
                .as("native-sql-files.txt 의 자리 수가 코드와 다르다. 옮겼으면 줄을 빼거나 수를 내리고, 새로 쓰면 남김: 과 까닭을 적은 줄로 올린다")
                .isEmpty();
    }

    @Test
    void pendingSitesOnlyShrink() throws IOException {
        int pending = rows().stream().filter(row -> row.reason() == null).mapToInt(Row::sites).sum();

        assertThat(pending)
                .as("까닭 없는 자리를 늘리지 않는다. 꼭 네이티브여야 하면 남김: 과 까닭을 적는다")
                .isLessThanOrEqualTo(PENDING_CEILING);
        assertThat(pending)
                .as("까닭 없는 자리가 줄었으면 PENDING_CEILING 도 %d 로 내린다", pending)
                .isEqualTo(PENDING_CEILING);
    }

    @Test
    void countsCallsOutsideCommentsAndStrings() {
        String code = """
                // em.createNativeQuery("in a line comment")
                /* em.createNativeQuery("in a block comment") */
                String sql = "createNativeQuery( in a string";
                String url = "https://example.com";
                em.createNativeQuery(sql, Tuple.class);
                @Query(value = "SELECT 1", nativeQuery = true)
                """;

        assertThat(sites(code)).isEqualTo(2);
    }

    private static Map<String, Integer> sitesInCode() throws IOException {
        Map<String, Integer> found = new TreeMap<>();
        try (Stream<Path> files = Files.walk(JAVA_ROOT)) {
            for (Path file : files.filter(path -> path.toString().endsWith(".java")).toList()) {
                int sites = sites(Files.readString(file, StandardCharsets.UTF_8));
                if (sites > 0) {
                    found.put(JAVA_ROOT.relativize(file).toString(), sites);
                }
            }
        }
        return found;
    }

    private static List<Row> rows() throws IOException {
        return Files.readAllLines(INVENTORY, StandardCharsets.UTF_8).stream()
                .filter(line -> !line.isBlank() && !line.startsWith("#"))
                .map(line -> {
                    Matcher row = ROW.matcher(line);
                    assertThat(row.matches()).as("줄 모양: <파일> <자리 수> [남김: <까닭>] — %s", line).isTrue();
                    return new Row(row.group(1), Integer.parseInt(row.group(2)), row.group(3));
                })
                .toList();
    }

    private static int sites(String code) {
        Matcher matcher = NATIVE.matcher(withoutCommentsAndStrings(code));
        int count = 0;
        while (matcher.find()) {
            count++;
        }
        return count;
    }

    /** 주석과 문자열·문자 리터럴(텍스트 블록 포함)을 지운 코드. 지운 리터럴 자리에는 빈칸을 둔다. */
    private static String withoutCommentsAndStrings(String code) {
        StringBuilder out = new StringBuilder();
        int i = 0;
        while (i < code.length()) {
            if (code.startsWith("//", i)) {
                int end = code.indexOf('\n', i);
                i = end < 0 ? code.length() : end;
            } else if (code.startsWith("/*", i)) {
                int end = code.indexOf("*/", i + 2);
                i = end < 0 ? code.length() : end + 2;
            } else if (code.startsWith("\"\"\"", i)) {
                int end = code.indexOf("\"\"\"", i + 3);
                while (end > 0 && code.charAt(end - 1) == '\\') {
                    end = code.indexOf("\"\"\"", end + 1);
                }
                i = end < 0 ? code.length() : end + 3;
                out.append(' ');
            } else if (code.charAt(i) == '"' || code.charAt(i) == '\'') {
                char quote = code.charAt(i);
                int end = i + 1;
                while (end < code.length() && code.charAt(end) != quote) {
                    end += code.charAt(end) == '\\' ? 2 : 1;
                }
                i = end + 1;
                out.append(' ');
            } else {
                out.append(code.charAt(i));
                i++;
            }
        }
        return out.toString();
    }

    private record Row(String file, int sites, String reason) {
    }
}
