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
 * <p>표는 문서에만 있고 이 테스트가 그 문서를 읽는다. 지금 어긋난 곳은 두 목록에 나뉘어 있다(ADR-040).
 *
 * <ul>
 *   <li>쓰기 예외 목록({@code table-owner-write-exceptions.txt}): 주인이 아닌 기능이 그 테이블에 <b>쓰는</b> 곳. 0 이 될 때까지
 *       줄기만 한다({@link #WRITE_EXCEPTION_CEILING}).</li>
 *   <li>읽기 전용 목록({@code table-owner-read-only.txt}): 주인이 아닌 기능이 그 테이블을 <b>읽기만</b> 하는 곳. 줄을 더하지
 *       않는다. 0 으로 줄일 대상은 아니다.</li>
 * </ul>
 *
 * <p>줄은 (파일, 테이블) 하나다. 그 파일에 그 테이블을 쓰는 문장이 하나라도 있으면 쓰기 예외 목록의 줄이다 — 같은 파일이 그
 * 테이블을 읽기도 해도 그렇다. 쓰는 문장을 주인에게 옮기고 읽는 문장만 남으면 그 줄을 읽기 전용 목록으로 옮긴다. 읽기 전용
 * 목록에 새로 생길 수 있는 줄은 이렇게 내려온 줄뿐이라, 두 목록을 합친 줄 수는 늘지 않는다({@link #EXCEPTION_CEILING}).
 *
 * <p>쓰는 문장: 그 테이블이 {@code INSERT INTO}·{@code UPDATE}·{@code DELETE FROM} 의 대상인 SQL·JPQL. 잠금만 잡는 조회
 * ({@code SELECT … FOR UPDATE})와 {@code INSERT … SELECT}·{@code UPDATE … FROM}·{@code DELETE … USING} 이 읽는 쪽 테이블은
 * 읽기다. 표 이름을 변수로 붙이는 SQL 은 어느 문장에 붙는지 글자로 알 수 없어 엄한 쪽으로 센다 — 통째로 표 이름인 리터럴은, 그
 * 파일에 변수로 붙이는 쓰기 문장({@code "DELETE FROM " + table})이 있거나 그 파일이 Schema Entity 면 쓰기다.
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

    private static final Path WRITE_EXCEPTIONS = Path.of("src/test/resources/table-owner-write-exceptions.txt");

    private static final Path READ_ONLY = Path.of("src/test/resources/table-owner-read-only.txt");

    private static final Path JAVA_ROOT = Path.of("src/main/java/com/acttub/actingapi");

    private static final Path RESOURCES = Path.of("src/main/resources");

    /**
     * 두 목록을 합친 줄 수. 줄을 더하면 실패한다. 어긋난 곳을 고쳐 줄을 뺐으면 이 수도 같이 내린다. 쓰기 예외 목록의 줄을 읽기
     * 전용 목록으로 옮길 때는 그대로다.
     *
     * <p>늘려야 할 것 같으면 먼저 주인의 {@code app} 층에 Port 를 두거나 주인을 다시 정한다.
     */
    private static final int EXCEPTION_CEILING = 197;

    /** 쓰기 예외 목록의 줄 수. 0 이 될 때까지 줄기만 한다. 줄을 빼거나 읽기 전용 목록으로 옮겼으면 이 수도 같이 내린다. */
    private static final int WRITE_EXCEPTION_CEILING = 1;

    private static final Pattern OWNER_ROW = Pattern.compile("^\\| `((?:feature|platform)/[a-z]+)` \\| (.+) \\|$");

    private static final Pattern BACKTICKED = Pattern.compile("`([a-z_0-9]+)`");

    private static final Pattern SQL_KEYWORD = Pattern.compile("(?i)(?<![:\\w.])(from|join|update|into|using|table)\\s+");

    /** 키워드 바로 앞의 낱말. {@code (DELETE FROM} 의 괄호 같은 기호는 건너뛴다. */
    private static final Pattern PREVIOUS_WORD = Pattern.compile("(\\w+)\\W*$");

    /** 표 이름을 변수로 붙이는 쓰기 문장: 리터럴이 쓰기 키워드에서 끝나거나({@code "DELETE FROM " + table}) 자리표시({@code %s})가 온다. */
    private static final Pattern DYNAMIC_WRITE = Pattern.compile(
            "(?i)(?:\\binsert\\s+into|\\bdelete\\s+from|(?<!for\\s)(?<!key\\s)(?<!do\\s)\\bupdate)\\s+(?:%s|\\z)");

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
    void onlyTheOwnerWritesItsTable() throws IOException {
        Set<String> writes = violations().writes();
        Set<String> allowed = lines(WRITE_EXCEPTIONS);

        Set<String> added = new TreeSet<>(writes);
        added.removeAll(allowed);
        assertThat(added)
                .as("주인이 아닌 기능이 테이블에 쓴다(줄 모양: <파일> <테이블>). 남의 테이블에 쓰는 문장은 더하지 않는다(ADR-040). "
                        + "주인의 app 층에 Port 를 두고 주인이 쓰게 한다. 주인은 docs/ARCHITECTURE.md 「테이블 주인」에 있다")
                .isEmpty();

        Set<String> fixed = new TreeSet<>(allowed);
        fixed.removeAll(writes);
        assertThat(fixed)
                .as("더는 쓰지 않는 줄이다. table-owner-write-exceptions.txt 에서 빼고 WRITE_EXCEPTION_CEILING 을 내린다. "
                        + "그 파일이 그 테이블을 아직 읽으면 table-owner-read-only.txt 로 옮기고, 아니면 EXCEPTION_CEILING 도 내린다")
                .isEmpty();
    }

    @Test
    void readsOfAnotherOwnersTableStayOnTheReadOnlyList() throws IOException {
        Violations violations = violations();
        Set<String> reads = new TreeSet<>(violations.all());
        reads.removeAll(violations.writes());
        Set<String> allowed = lines(READ_ONLY);

        Set<String> added = new TreeSet<>(reads);
        added.removeAll(allowed);
        assertThat(added)
                .as("주인이 아닌 기능이 테이블을 읽는다(줄 모양: <파일> <테이블>). 읽기 전용 목록에 줄을 더하지 않는다 — 주인의 "
                        + "app 층을 보세요. 쓰기 예외 목록에서 쓰는 문장만 빠진 줄이면 table-owner-read-only.txt 로 옮긴다")
                .isEmpty();

        Set<String> fixed = new TreeSet<>(allowed);
        fixed.removeAll(reads);
        assertThat(fixed)
                .as("더는 읽기만 하는 줄이 아니다. 고쳤으면 table-owner-read-only.txt 에서 빼고 EXCEPTION_CEILING 을 내린다. "
                        + "쓰는 문장이 생긴 줄이면 그 쓰기를 주인에게 옮긴다")
                .isEmpty();
    }

    @Test
    void exceptionListsOnlyShrink() throws IOException {
        Set<String> writes = lines(WRITE_EXCEPTIONS);
        Set<String> reads = lines(READ_ONLY);
        assertThat(writes).as("한 줄은 두 목록 가운데 한 곳에만 있다").doesNotContainAnyElementsOf(reads);

        assertThat(writes.size())
                .as("쓰기 예외 목록에 줄을 더하지 않는다. 주인의 app 층에 Port 를 두고 주인이 쓰게 한다")
                .isLessThanOrEqualTo(WRITE_EXCEPTION_CEILING);
        assertThat(writes.size())
                .as("쓰기 예외 목록에서 줄을 뺐으면 WRITE_EXCEPTION_CEILING 도 %d 로 내린다", writes.size())
                .isEqualTo(WRITE_EXCEPTION_CEILING);

        int total = writes.size() + reads.size();
        assertThat(total)
                .as("두 목록에 줄을 더하지 않는다. 읽기 전용 목록에는 쓰기 예외 목록에서 내려온 줄만 생긴다")
                .isLessThanOrEqualTo(EXCEPTION_CEILING);
        assertThat(total)
                .as("목록에서 줄을 뺐으면 EXCEPTION_CEILING 도 %d 로 내린다", total)
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
    void tellsTheTableAStatementWritesFromTheOnesItReads() {
        Set<String> tables = Set.of("users", "videos", "scripts", "user_profiles");
        Map<String, String> entities = Map.of("UserEntity", "users");

        assertThat(writtenIn("UPDATE videos SET user_id=:to WHERE user_id=:from", tables, entities)).containsExactly("videos");
        assertThat(writtenIn("DELETE FROM videos USING scripts WHERE videos.id=scripts.id", tables, entities))
                .as("USING 은 읽는 쪽이다").containsExactly("videos");
        assertThat(writtenIn("INSERT INTO user_profiles(user_id) SELECT id FROM users", tables, entities))
                .as("INSERT … SELECT 의 FROM 은 읽는 쪽이다").containsExactly("user_profiles");
        assertThat(writtenIn("UPDATE videos SET favorite=false FROM users WHERE users.id=videos.user_id", tables, entities))
                .as("UPDATE … FROM 은 읽는 쪽이다").containsExactly("videos");
        assertThat(writtenIn("WITH removed AS (DELETE FROM scripts WHERE user_id=:id RETURNING id) SELECT id FROM removed",
                tables, entities)).as("괄호 안의 DELETE").containsExactly("scripts");
        assertThat(writtenIn("update UserEntity u set u.email = null where u.id = :id", tables, entities)).containsExactly("users");
        assertThat(writtenIn("delete from UserEntity u where u.id = :id", tables, entities)).containsExactly("users");

        assertThat(writtenIn("SELECT id FROM users WHERE id=:id FOR UPDATE", tables, entities)).as("잠금은 읽기다").isEmpty();
        assertThat(writtenIn("SELECT id FROM videos FOR NO KEY UPDATE OF videos", tables, entities)).isEmpty();
        assertThat(writtenIn("SELECT v.id FROM videos v JOIN users u ON u.id=v.user_id", tables, entities)).isEmpty();
        assertThat(writtenIn(
                "INSERT INTO scripts(id) VALUES (:id) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title", tables, entities))
                .as("DO UPDATE 뒤는 표가 아니다").containsExactly("scripts");

        assertThat(DYNAMIC_WRITE.matcher("DELETE FROM ").find()).isTrue();
        assertThat(DYNAMIC_WRITE.matcher("UPDATE ").find()).isTrue();
        assertThat(DYNAMIC_WRITE.matcher("DELETE FROM %s AS child USING scripts").find()).isTrue();
        assertThat(DYNAMIC_WRITE.matcher("SELECT id FROM ").find()).isFalse();
        assertThat(DYNAMIC_WRITE.matcher("SELECT id FROM users FOR UPDATE\n        ").find())
                .as("잠금 절로 끝나는 텍스트 블록").isFalse();
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
        Map<String, Touched> references = references();
        assertThat(references).as("표를 하나도 못 찾았다 — 읽는 법이 코드와 어긋났다").isNotEmpty();
        // 표 이름을 변수로 붙이는 SQL("UPDATE " + table). 쓰는 문장이라 쓰기로 센다.
        assertThat(references.get("platform/operation/ExternalOperationOwnership.java").all())
                .contains("external_operations", "ai_jobs");
        assertThat(references.get("platform/operation/ExternalOperationOwnership.java").written())
                .contains("external_operations", "ai_jobs");
        // FROM a, b
        assertThat(references.get("feature/memory/adapter/db/PostgresActorMemoryStore.java").all()).contains("users");
        // JPQL 의 엔티티 이름과 Schema Entity 의 @Table. Schema Entity 는 쓰는 길을 열므로 쓰기로 센다.
        assertThat(references.get("feature/auth/adapter/db/UserJpaRepository.java").all())
                .contains("users", "user_identities");
        assertThat(references.get("feature/auth/schema/UserEntity.java").all()).containsExactly("users");
        assertThat(references.get("feature/auth/schema/UserEntity.java").written()).containsExactly("users");
        // JPQL 로 쓰는 문장과 읽기만 하는 파일
        assertThat(references.get("feature/auth/adapter/db/PostgresAccountDeactivation.java").written()).containsExactly("users");
        assertThat(references.get("resources/admin/ops-core.sql").written()).as("운영 지표는 읽기만 한다").isEmpty();
        // resources 의 SQL 파일
        assertThat(references.get("resources/admin/ops-core.sql").all()).contains("users", "summaries");
    }

    /** 한 파일이 건드리는 테이블({@code all})과 그 가운데 쓰는 테이블({@code written}). */
    private record Touched(Set<String> all, Set<String> written) {
    }

    /** 주인이 아닌 곳의 참조({@code all})와 그 가운데 쓰는 것({@code writes}). 줄 모양은 목록과 같은 {@code <파일> <테이블>} 이다. */
    private record Violations(Set<String> all, Set<String> writes) {
    }

    /** 파일 → 그 파일이 건드리는 테이블. 파일은 {@code src/main/java/com/acttub/actingapi} 또는 {@code src/main} 아래 경로다. */
    private static Map<String, Touched> references() throws IOException {
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

        Map<String, Touched> references = new TreeMap<>();
        code.forEach((file, text) -> {
            Set<String> found = new TreeSet<>();
            Set<String> written = new TreeSet<>();
            boolean touchesDatabase = TOUCHES_DATABASE.matcher(text).find();
            List<String> literals = literals(text);
            // 통째로 표 이름인 리터럴이 어느 문장에 붙는지는 알 수 없다. 쓰는 길이 이 파일에 있으면 쓰기로 센다.
            boolean namesMayBeWritten = text.contains("@Entity")
                    || literals.stream().anyMatch(literal -> DYNAMIC_WRITE.matcher(literal).find());
            for (String literal : literals) {
                found.addAll(tablesIn(literal, tables, entities));
                written.addAll(writtenIn(literal, tables, entities));
                if (touchesDatabase && tables.contains(literal)) {
                    found.add(literal);
                    if (namesMayBeWritten) {
                        written.add(literal);
                    }
                }
            }
            if (!found.isEmpty()) {
                references.put(JAVA_ROOT.relativize(file).toString(), new Touched(found, written));
            }
        });
        try (Stream<Path> files = Files.walk(RESOURCES)) {
            for (Path file : files.filter(path -> path.toString().endsWith(".sql"))
                    .filter(path -> !path.startsWith(RESOURCES.resolve("db"))).toList()) {
                String sql = Files.readString(file, StandardCharsets.UTF_8).replaceAll("--[^\\n]*", " ");
                Set<String> found = tablesIn(sql, tables, entities);
                if (!found.isEmpty()) {
                    references.put("resources/" + RESOURCES.relativize(file), new Touched(found, writtenIn(sql, tables, entities)));
                }
            }
        }
        return references;
    }

    private static Violations violations() throws IOException {
        Map<String, String> owners = owners();
        Set<String> all = new TreeSet<>();
        Set<String> writes = new TreeSet<>();
        references().forEach((file, touched) -> {
            String module = moduleOf(file);
            for (String table : touched.all()) {
                // 주인이 없는 테이블은 everyTableHasExactlyOneOwner 가 알린다.
                String owner = owners.get(table);
                if (owner != null && !owner.equals(module)) {
                    all.add(file + " " + table);
                    if (touched.written().contains(table)) {
                        writes.add(file + " " + table);
                    }
                }
            }
        });
        return new Violations(all, writes);
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
        return usesIn(sql, tables, entities).keySet();
    }

    /** 그 가운데 문장이 쓰는 테이블: {@code INSERT INTO}·{@code UPDATE}·{@code DELETE FROM} 의 대상. */
    private static Set<String> writtenIn(String sql, Set<String> tables, Map<String, String> entities) {
        Set<String> written = new TreeSet<>();
        usesIn(sql, tables, entities).forEach((table, write) -> {
            if (write) {
                written.add(table);
            }
        });
        return written;
    }

    /** 테이블 → 그 테이블에 쓰는 자리가 하나라도 있는가. */
    private static Map<String, Boolean> usesIn(String sql, Set<String> tables, Map<String, String> entities) {
        Map<String, Boolean> found = new TreeMap<>();
        Matcher keyword = SQL_KEYWORD.matcher(sql);
        while (keyword.find()) {
            boolean write = writes(keyword.group(1), sql.substring(0, keyword.start()));
            // 쓰기 키워드의 대상은 바로 뒤의 한 테이블이다. 쉼표로 잇는 나머지(FROM a, b)는 읽는 쪽이다.
            boolean target = true;
            int at = keyword.end();
            while (true) {
                Matcher name = IDENTIFIER.matcher(sql).region(at, sql.length());
                if (!name.lookingAt()) {
                    break;
                }
                String table = tables.contains(name.group()) ? name.group() : entities.get(name.group());
                if (table != null) {
                    found.merge(table, write && target, Boolean::logicalOr);
                }
                target = false;
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

    /** 이 키워드 뒤의 테이블이 쓰는 대상인가. {@code FOR UPDATE}·{@code FOR NO KEY UPDATE}·{@code DO UPDATE} 는 아니다. */
    private static boolean writes(String keyword, String before) {
        Matcher previous = PREVIOUS_WORD.matcher(before);
        String word = previous.find() ? previous.group(1).toLowerCase(java.util.Locale.ROOT) : "";
        return switch (keyword.toLowerCase(java.util.Locale.ROOT)) {
            case "into" -> true;
            case "update" -> !Set.of("for", "key", "do").contains(word);
            case "from" -> word.equals("delete");
            default -> false;
        };
    }

    private static int skipSpaces(String text, int at) {
        while (at < text.length() && Character.isWhitespace(text.charAt(at))) {
            at++;
        }
        return at;
    }

    /** 주석을 건너뛰고 문자열 리터럴(텍스트 블록 포함)의 내용을 차례로 모은다. 이스케이프는 풀지 않는다. */
    static List<String> literals(String code) {
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

    /** 목록 파일의 줄. 빈 줄과 {@code #} 로 시작하는 줄은 건너뛴다. */
    private static Set<String> lines(Path list) throws IOException {
        List<String> lines = Files.readAllLines(list, StandardCharsets.UTF_8).stream()
                .map(String::strip)
                .filter(line -> !line.isEmpty() && !line.startsWith("#"))
                .toList();
        Set<String> unique = new TreeSet<>(lines);
        assertThat(unique).as("%s 에 같은 줄이 두 번 있다", list.getFileName()).hasSize(lines.size());
        return unique;
    }
}
