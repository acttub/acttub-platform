package com.acttub.actingapi;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import com.acttub.actingapi.feature.auth.domain.UserStatusTransition;
import com.acttub.actingapi.feature.practice.domain.PracticeStageTransition;
import com.acttub.actingapi.platform.ledger.AiJobStatusTransition;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * 상태 칸을 바꾸는 문장은 그 상태의 파일 한 곳에만 있고, 그 문장들은 도메인의 허용 전이 표와 맞는다 (docs/ARCHITECTURE.md
 * 「테이블 주인」, 로드맵 18번 6단계).
 *
 * <p>상태를 바꾸는 UPDATE 가 여러 파일에 흩어지면 어떤 길로 상태가 넘어가는지 한 곳에서 읽히지 않고, 표에 없는 길이 조용히
 * 생긴다. 여기서는 {@code src/main} 의 문자열(SQL·JPQL)에서 그 칸을 SET 하는 UPDATE 를 모두 찾아 본다. 조건(WHERE)은 SQL 에
 * 그대로 둔다 — 조건부 UPDATE 한 문장이 경합에서 진 요청을 0행으로 돌려보내는 장치다(apps/api/CONTRACT.md §5-2).
 */
class StateTransitionTest {

    private static final Path JAVA_ROOT = Path.of("src/main/java/com/acttub/actingapi");

    /** 표의 한 줄. {@code from} 은 SQL 이 조건으로 걸 때만 견준다. {@code reason} 이 없으면 사유를 적지 않거나 비운다. */
    record Allowed(String name, String from, String to, String reason) {
    }

    /**
     * 상태 칸 하나.
     *
     * @param table native SQL 의 표 이름
     * @param entity JPQL 의 엔티티 이름
     * @param column 상태 칸(native 와 JPQL 의 이름이 같다)
     * @param reasonColumns 상태와 함께 적는 사유 칸의 이름들(native, JPQL). 사유를 표에 적지 않는 상태는 비운다
     * @param parameters 값을 글자 그대로 적지 못하는 문장(변환기가 붙은 enum 칸)의 매개변수 이름과 그 값
     * @param home 이 칸을 바꾸는 문장을 모아 둔 파일({@code src/main/java/com/acttub/actingapi} 아래 경로)
     */
    record StateColumn(
            String table, String entity, String column, List<String> reasonColumns, Map<String, String> parameters, String home,
            List<Allowed> allowed) {
        @Override
        public String toString() {
            return table + "." + column;
        }
    }

    /** 상태를 바꾸는 문장 하나. */
    record Found(String file, String from, String to, String reason, String sql) {
    }

    static Stream<StateColumn> stateColumns() {
        return Stream.of(
                new StateColumn(
                        "practices", "PracticeEntity", "stage", List.of("close_reason", "closeReason"), Map.of(),
                        "feature/practice/adapter/db/PostgresPracticeStageTransitions.java",
                        Arrays.stream(PracticeStageTransition.values())
                                .map(transition -> new Allowed(
                                        transition.name(), transition.from(), transition.to(), transition.closeReason()))
                                .toList()),
                new StateColumn(
                        "ai_jobs", "AiJobEntity", "status", List.of(), Map.of(),
                        "platform/operation/PostgresAiJobLedger.java",
                        Arrays.stream(AiJobStatusTransition.values())
                                .map(transition -> new Allowed(transition.name(), transition.from(), transition.to(), null))
                                .toList()),
                new StateColumn(
                        "users", "UserEntity", "status", List.of(), Map.of("deactivated", "deactivated"),
                        "feature/auth/adapter/db/PostgresAccountDeactivation.java",
                        Arrays.stream(UserStatusTransition.values())
                                .map(transition -> new Allowed(transition.name(), transition.from(), transition.to(), null))
                                .toList()));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("stateColumns")
    @DisplayName("상태를 바꾸는 UPDATE 는 그 상태의 파일에만 있고, 문장마다 허용 전이 표의 한 줄이며, 표의 줄마다 문장이 있다")
    void everyStateChangeIsAnAllowedTransitionInItsHomeFile(StateColumn state) {
        List<Found> found = updatesOf(state);
        assertThat(found).as("찾은 문장이 없으면 아래 검사가 조용히 통과한다").hasSizeGreaterThanOrEqualTo(state.allowed().size());

        assertThat(found.stream().filter(update -> !update.file().equals(state.home())).map(Found::file).distinct())
                .as("%s 를 바꾸는 문장이 %s 밖에 있다. 그 파일로 옮기고 허용 전이 표에 있는 길인지 본다", state, state.home())
                .isEmpty();
        for (Found update : found) {
            assertThat(state.allowed().stream().filter(allowed -> matches(allowed, update)))
                    .as("허용 전이 표에 없는 길이다: %s → %s (사유 %s)%n%s", update.from(), update.to(), update.reason(), update.sql())
                    .isNotEmpty();
        }
        for (Allowed allowed : state.allowed()) {
            assertThat(found.stream().filter(update -> matches(allowed, update)))
                    .as("표의 %s 에 해당하는 문장이 없다. 길이 없어졌으면 표에서도 지운다", allowed.name())
                    .isNotEmpty();
        }
    }

    private static boolean matches(Allowed allowed, Found update) {
        return allowed.to().equals(update.to())
                && Objects.equals(allowed.reason(), update.reason())
                && (update.from() == null || update.from().equals(allowed.from()));
    }

    /** {@code src/main} 의 모든 문자열에서 이 칸을 SET 하는 UPDATE 를 찾는다. */
    private static List<Found> updatesOf(StateColumn state) {
        Pattern update = Pattern.compile(
                "\\bupdate (?:" + state.table() + "|" + state.entity().toLowerCase(Locale.ROOT) + ")\\b(?: \\w+)? set (.+?)(?: where (.+))?$");
        Pattern target = Pattern.compile("(?:^|[ ,])(?:\\w+\\.)?" + state.column() + " ?= ?(?:'(\\w+)'|:(\\w+)|(\\S+))");
        Pattern condition = Pattern.compile("(?:^|[ (])(?:\\w+\\.)?" + state.column() + " ?= ?'(\\w+)'");
        Pattern reason = state.reasonColumns().isEmpty() ? null : Pattern.compile("(?:^|[ ,])(?:\\w+\\.)?(?:"
                + String.join("|", state.reasonColumns()).toLowerCase(Locale.ROOT) + ") ?= ?(?:'(\\w+)'|null)");
        List<Found> found = new ArrayList<>();
        try (Stream<Path> files = Files.walk(JAVA_ROOT)) {
            for (Path file : files.filter(path -> path.toString().endsWith(".java")).sorted().toList()) {
                for (String literal : TableOwnerTest.literals(Files.readString(file))) {
                    String sql = literal.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
                    Matcher statement = update.matcher(sql);
                    if (!statement.find()) {
                        continue;
                    }
                    Matcher to = target.matcher(statement.group(1));
                    if (!to.find()) {
                        continue;
                    }
                    String value = to.group(1) != null ? to.group(1) : state.parameters().get(to.group(2));
                    assertThat(value)
                            .as("%s 에 무엇을 적는지 문장에서 읽히지 않는다. 값을 글자 그대로 적거나 매개변수의 값을 이 테스트에 적는다:%n%s",
                                    state, sql)
                            .isNotNull();
                    Matcher why = reason == null ? null : reason.matcher(statement.group(1));
                    Matcher from = condition.matcher(statement.group(2) == null ? "" : statement.group(2));
                    found.add(new Found(
                            JAVA_ROOT.relativize(file).toString(),
                            from.find() ? from.group(1) : null,
                            value,
                            why != null && why.find() ? why.group(1) : null,
                            sql));
                }
            }
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        }
        return found;
    }
}
