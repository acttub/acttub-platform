package com.acttub.actingapi;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
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
 * 테이블마다 주인이 하나이고, 주인이 아닌 기능의 SQL·JPQL·Schema Entity 에는 그 테이블이 나오지 않는다
 * (docs/ARCHITECTURE.md 「테이블 주인」).
 *
 * <p>표는 문서에만 있고 이 테스트가 그 문서를 읽는다. 지금 어긋난 곳은 허용 목록에 적혀 있고, 목록은 줄을 빼기만 한다
 * ({@link #EXCEPTION_CEILING}).
 *
 * <p>찾는 법: {@code src/main/java} 의 문자열 리터럴(텍스트 블록 포함)과 {@code src/main/resources} 의 SQL 파일에서
 * SQL 이 표를 고르는 자리({@code FROM}·{@code JOIN}·{@code UPDATE}·{@code INTO}·{@code USING}·{@code TABLE} 뒤, 쉼표로 잇는
 * {@code FROM a, b} 포함)에 나오는 이름을 모은다. JPQL 의 엔티티 이름은 그 엔티티의 {@code @Table} 로 바꾼다. 표 이름을
 * 변수로 붙이는 SQL({@code "DELETE FROM " + table})을 위해, DB 를 다루는 파일에서는 통째로 표 이름인 리터럴도 센다 —
 * {@code @Table(name = "users")} 도 여기서 잡힌다.
 */
class TableOwnerTest {

    /** Gradle 은 {@code apps/api} 에서 테스트를 돌린다. */
    private static final Path ARCHITECTURE = Path.of("../../docs/ARCHITECTURE.md");

    private static final Path FINGERPRINT = Path.of("src/test/resources/baseline-schema-fingerprint.txt");

    private static final Path EXCEPTIONS = Path.of("src/test/resources/table-owner-exceptions.txt");

    private static final Path JAVA_ROOT = Path.of("src/main/java/com/acttub/actingapi");

    private static final Path RESOURCES = Path.of("src/main/resources");

    /**
     * 허용 목록의 줄 수. 줄을 더하면 실패한다. 어긋난 곳을 고쳐 줄을 뺐으면 이 수도 같이 내린다.
     *
     * <p>늘려야 할 것 같으면 먼저 주인의 {@code app} 층에 Port 를 두거나 주인을 다시 정한다.
     */
    private static final int EXCEPTION_CEILING = 307;

    private static final Pattern OWNER_ROW = Pattern.compile("^\\| `((?:feature|platform)/[a-z]+)` \\| (.+) \\|$");

    private static final Pattern BACKTICKED = Pattern.compile("`([a-z_0-9]+)`");

    private static final Pattern SQL_KEYWORD = Pattern.compile("(?i)(?<![:\\w.])(?:from|join|update|into|using|table)\\s+");

    private static final Pattern IDENTIFIER = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");

    private static final Pattern TABLE_ANNOTATION = Pattern.compile("@Table\\s*\\(\\s*name\\s*=\\s*\"(\\w+)\"");

    /** 표 이름을 변수로 붙이는 SQL 을 쓸 수 있는 파일. 이런 파일에서만 통째로 표 이름인 리터럴을 센다. */
    private static final Pattern TOUCHES_DATABASE = Pattern.compile("EntityManager|@Table|@Query");

    @Test
    void everyTableHasExactlyOneOwner() throws IOException {
        Map<String, String> owners = owners();
        assertThat(owners.keySet())
                .as("docs/ARCHITECTURE.md 「테이블 주인」의 테이블 = DB 의 테이블(baseline-schema-fingerprint.txt)")
                .isEqualTo(tables());
        for (String owner : new TreeSet<>(owners.values())) {
            assertThat(JAVA_ROOT.resolve(owner)).as("주인 %s 패키지가 있다", owner).isDirectory();
        }
    }

    @Test
    void onlyTheOwnerTouchesItsTable() throws IOException {
        Set<String> violations = violations();
        Set<String> allowed = exceptions();

        Set<String> added = new TreeSet<>(violations);
        added.removeAll(allowed);
        assertThat(added)
                .as("주인이 아닌 기능이 테이블을 건드린다(줄 모양: <파일> <테이블>). 주인의 app 층을 보세요. "
                        + "주인은 docs/ARCHITECTURE.md 「테이블 주인」에 있다")
                .isEmpty();

        Set<String> fixed = new TreeSet<>(allowed);
        fixed.removeAll(violations);
        assertThat(fixed)
                .as("더는 어긋나지 않는 줄이다. table-owner-exceptions.txt 에서 빼고 EXCEPTION_CEILING 도 내린다")
                .isEmpty();
    }

    @Test
    void exceptionListOnlyShrinks() throws IOException {
        int lines = exceptions().size();
        assertThat(lines)
                .as("허용 목록에 줄을 더하지 않는다. 주인의 app 층에 Port 를 두거나 주인을 다시 정한다")
                .isLessThanOrEqualTo(EXCEPTION_CEILING);
        assertThat(lines)
                .as("허용 목록에서 줄을 뺐으면 EXCEPTION_CEILING 도 %d 로 내린다", lines)
                .isEqualTo(EXCEPTION_CEILING);
    }

    @Test
    void readsTableNamesWhereSqlPicksTables() {
        Set<String> tables = Set.of("users", "videos", "scripts", "user_profiles");
        Map<String, String> entities = Map.of("UserEntity", "users");

        assertThat(tablesIn("SELECT v.id FROM videos v JOIN users u ON u.id=v.user_id", tables, entities))
                .containsExactlyInAnyOrder("videos", "users");
        assertThat(tablesIn("FROM target,users u", tables, entities)).containsExactly("users");
        assertThat(tablesIn("FROM videos AS v, scripts s WHERE s.id=v.id", tables, entities))
                .containsExactlyInAnyOrder("videos", "scripts");
        assertThat(tablesIn("DELETE FROM videos USING scripts WHERE videos.id=scripts.id", tables, entities))
                .containsExactlyInAnyOrder("videos", "scripts");
        assertThat(tablesIn("INSERT INTO user_profiles(user_id) SELECT id FROM users", tables, entities))
                .containsExactlyInAnyOrder("user_profiles", "users");
        assertThat(tablesIn("SELECT u FROM UserEntity u WHERE u.id = :id", tables, entities)).containsExactly("users");
        assertThat(tablesIn("UPDATE videos SET user_id=:to WHERE user_id=:from", tables, entities))
                .as(":from 은 매개변수다").containsExactly("videos");
        assertThat(tablesIn("SELECT id FROM videos FOR UPDATE OF v", tables, entities)).containsExactly("videos");
        assertThat(tablesIn("/v2/videos/{id}", tables, entities)).isEmpty();
    }

    @Test
    void readsJavaStringLiteralsWithoutComments() {
        String code = """
                // "FROM comment_line"
                /* "FROM comment_block" */
                String a = "FROM users";
                String b = \"""
                        SELECT 1 FROM videos
                        \""";
                char c = '"';
                String d = "escaped \\" quote";
                """;
        assertThat(literals(code)).containsExactly("FROM users", "        SELECT 1 FROM videos\n        ",
                "escaped \\\" quote");
    }

    @Test
    void scansDynamicSqlJpqlAnnotationsAndResourceSql() throws IOException {
        Map<String, Set<String>> references = references();
        assertThat(references).as("표를 하나도 못 찾았다 — 읽는 법이 코드와 어긋났다").isNotEmpty();
        // 표 이름을 변수로 붙이는 SQL("UPDATE " + table)
        assertThat(references.get("feature/reading/adapter/db/PostgresReadingOwnership.java"))
                .contains("reading_session_ratings");
        // FROM a, b
        assertThat(references.get("feature/memory/adapter/db/PostgresActorMemoryStore.java")).contains("users");
        // JPQL 의 엔티티 이름과 Schema Entity 의 @Table
        assertThat(references.get("feature/auth/adapter/db/UserJpaRepository.java"))
                .contains("users", "user_identities");
        assertThat(references.get("feature/auth/schema/UserEntity.java")).containsExactly("users");
        // resources 의 SQL 파일
        assertThat(references.get("resources/admin/ops-core.sql")).contains("users", "summaries");
    }

    /** 파일 → 그 파일이 건드리는 테이블. 파일은 {@code src/main/java/com/acttub/actingapi} 또는 {@code src/main} 아래 경로다. */
    private static Map<String, Set<String>> references() throws IOException {
        Set<String> tables = tables();
        Map<Path, String> code = new TreeMap<>();
        try (Stream<Path> files = Files.walk(JAVA_ROOT)) {
            for (Path file : files.filter(path -> path.toString().endsWith(".java")).toList()) {
                code.put(file, Files.readString(file, StandardCharsets.UTF_8));
            }
        }
        Map<String, String> entities = new TreeMap<>();
        code.forEach((file, text) -> {
            Matcher table = TABLE_ANNOTATION.matcher(text);
            if (text.contains("@Entity") && table.find()) {
                entities.put(file.getFileName().toString().replace(".java", ""), table.group(1));
            }
        });

        Map<String, Set<String>> references = new TreeMap<>();
        code.forEach((file, text) -> {
            Set<String> found = new TreeSet<>();
            boolean touchesDatabase = TOUCHES_DATABASE.matcher(text).find();
            for (String literal : literals(text)) {
                found.addAll(tablesIn(literal, tables, entities));
                if (touchesDatabase && tables.contains(literal)) {
                    found.add(literal);
                }
            }
            if (!found.isEmpty()) {
                references.put(JAVA_ROOT.relativize(file).toString(), found);
            }
        });
        try (Stream<Path> files = Files.walk(RESOURCES)) {
            for (Path file : files.filter(path -> path.toString().endsWith(".sql"))
                    .filter(path -> !path.startsWith(RESOURCES.resolve("db"))).toList()) {
                String sql = Files.readString(file, StandardCharsets.UTF_8).replaceAll("--[^\\n]*", " ");
                Set<String> found = tablesIn(sql, tables, entities);
                if (!found.isEmpty()) {
                    references.put("resources/" + RESOURCES.relativize(file), found);
                }
            }
        }
        return references;
    }

    /** 주인이 아닌 곳의 참조. 줄 모양은 허용 목록과 같은 {@code <파일> <테이블>} 이다. */
    private static Set<String> violations() throws IOException {
        Map<String, String> owners = owners();
        Set<String> violations = new TreeSet<>();
        references().forEach((file, tables) -> {
            String module = moduleOf(file);
            for (String table : tables) {
                // 주인이 없는 테이블은 everyTableHasExactlyOneOwner 가 알린다.
                String owner = owners.get(table);
                if (owner != null && !owner.equals(module)) {
                    violations.add(file + " " + table);
                }
            }
        });
        return violations;
    }

    /** {@code feature/admin/adapter/db/X.java} → {@code feature/admin}, {@code resources/admin/ops-core.sql} → {@code feature/admin}. */
    private static String moduleOf(String file) {
        String[] parts = file.split("/");
        String module = parts[0].equals("resources") ? "feature/" + parts[1] : parts[0] + "/" + parts[1];
        assertThat(JAVA_ROOT.resolve(module)).as("%s 의 기능 %s 패키지가 있다", file, module).isDirectory();
        return module;
    }

    /** SQL 이 표를 고르는 자리에 나오는 테이블. 엔티티 이름(JPQL)은 그 엔티티의 테이블로 바꾼다. */
    private static Set<String> tablesIn(String sql, Set<String> tables, Map<String, String> entities) {
        Set<String> found = new TreeSet<>();
        Matcher keyword = SQL_KEYWORD.matcher(sql);
        while (keyword.find()) {
            int at = keyword.end();
            while (true) {
                Matcher name = IDENTIFIER.matcher(sql).region(at, sql.length());
                if (!name.lookingAt()) {
                    break;
                }
                if (tables.contains(name.group())) {
                    found.add(name.group());
                } else if (entities.containsKey(name.group())) {
                    found.add(entities.get(name.group()));
                }
                // 별칭(AS 포함)을 건너뛰고 쉼표가 오면 다음 테이블을 읽는다: FROM a x, b AS y
                at = skipSpaces(sql, name.end());
                for (int aliasWords = 0; aliasWords < 2; aliasWords++) {
                    Matcher alias = IDENTIFIER.matcher(sql).region(at, sql.length());
                    if (!alias.lookingAt()) {
                        break;
                    }
                    at = skipSpaces(sql, alias.end());
                    if (!alias.group().equalsIgnoreCase("as")) {
                        break;
                    }
                }
                if (at >= sql.length() || sql.charAt(at) != ',') {
                    break;
                }
                at = skipSpaces(sql, at + 1);
            }
        }
        return found;
    }

    private static int skipSpaces(String text, int at) {
        while (at < text.length() && Character.isWhitespace(text.charAt(at))) {
            at++;
        }
        return at;
    }

    /** 주석을 건너뛰고 문자열 리터럴(텍스트 블록 포함)의 내용을 차례로 모은다. 이스케이프는 풀지 않는다. */
    private static List<String> literals(String code) {
        List<String> literals = new ArrayList<>();
        int at = 0;
        while (at < code.length()) {
            if (code.startsWith("//", at)) {
                int end = code.indexOf('\n', at);
                at = end < 0 ? code.length() : end;
            } else if (code.startsWith("/*", at)) {
                at = code.indexOf("*/", at + 2) + 2;
            } else if (code.startsWith("\"\"\"", at)) {
                int end = at + 3;
                while (!code.startsWith("\"\"\"", end) || code.charAt(end - 1) == '\\') {
                    end++;
                }
                literals.add(code.substring(code.indexOf('\n', at) + 1, end));
                at = end + 3;
            } else if (code.charAt(at) == '"' || code.charAt(at) == '\'') {
                char quote = code.charAt(at);
                int end = at + 1;
                while (code.charAt(end) != quote) {
                    end += code.charAt(end) == '\\' ? 2 : 1;
                }
                if (quote == '"') {
                    literals.add(code.substring(at + 1, end));
                }
                at = end + 1;
            } else {
                at++;
            }
        }
        return literals;
    }

    /** docs/ARCHITECTURE.md 「테이블 주인」 표: 테이블 → 주인. 한 테이블이 두 번 나오면 실패한다. */
    private static Map<String, String> owners() throws IOException {
        Map<String, String> owners = new TreeMap<>();
        boolean inSection = false;
        for (String line : Files.readAllLines(ARCHITECTURE, StandardCharsets.UTF_8)) {
            if (line.startsWith("#")) {
                inSection = line.equals("### 테이블 주인");
                continue;
            }
            Matcher row = OWNER_ROW.matcher(line);
            if (!inSection || !row.matches()) {
                continue;
            }
            Matcher table = BACKTICKED.matcher(row.group(2));
            while (table.find()) {
                String previous = owners.put(table.group(1), row.group(1));
                assertThat(previous).as("%s 의 주인이 둘이다(%s, %s)", table.group(1), previous, row.group(1)).isNull();
            }
        }
        assertThat(owners).as("docs/ARCHITECTURE.md 「테이블 주인」 표를 못 읽었다").isNotEmpty();
        return owners;
    }

    /** 마이그레이션을 모두 적용한 DB 의 테이블. 스키마가 바뀌는 PR 마다 다시 만드는 지문 파일에서 읽는다. */
    private static Set<String> tables() throws IOException {
        Set<String> tables = new TreeSet<>();
        for (String line : Files.readAllLines(FINGERPRINT, StandardCharsets.UTF_8)) {
            if (line.startsWith("TABLE ")) {
                tables.add(line.split(" ")[1]);
            }
        }
        return tables;
    }

    /** 허용 목록. 빈 줄과 {@code #} 로 시작하는 줄은 건너뛴다. */
    private static Set<String> exceptions() throws IOException {
        List<String> lines = Files.readAllLines(EXCEPTIONS, StandardCharsets.UTF_8).stream()
                .map(String::strip)
                .filter(line -> !line.isEmpty() && !line.startsWith("#"))
                .toList();
        Set<String> unique = new TreeSet<>(lines);
        assertThat(unique).as("허용 목록에 같은 줄이 두 번 있다").hasSize(lines.size());
        return unique;
    }
}
