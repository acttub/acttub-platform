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
import com.acttub.actingapi.feature.billing.domain.CheckoutStatusTransition;
import com.acttub.actingapi.feature.billing.domain.SubscriptionStatusTransition;
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
 *
 * <p>바깥이 말한 상태를 통째로 받아 적는 upsert({@code ON CONFLICT … DO UPDATE SET status=EXCLUDED.status})는 표의 줄에 묶이지
 * 않는다. 대신 그런 문장을 둘 수 있는 파일을 상태마다 적어 두고({@code syncFiles}), 그 밖에 생기면 실패한다.
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
     * @param parameters 값을 글자 그대로 적지 못하는 문장(변환기가 붙은 enum 칸, 여러 끝 상태를 한 문장으로 적는 닫기)의 매개변수
     *        이름과 그 자리에 올 수 있는 값들
     * @param home 이 칸을 바꾸는 문장을 모아 둔 파일({@code src/main/java/com/acttub/actingapi} 아래 경로)
     * @param syncFiles 바깥이 말한 상태를 받아 적는 upsert 를 둘 수 있는 파일. 없으면 비운다
     */
    record StateColumn(
            String table, String entity, String column, List<String> reasonColumns, Map<String, List<String>> parameters,
            String home, List<String> syncFiles, List<Allowed> allowed) {
        @Override
        public String toString() {
            return table + "." + column;
        }
    }

    /** 상태를 바꾸는 문장 하나. {@code to} 가 {@link #ANY} 면 바깥이 말한 상태를 받아 적는 upsert 다. */
    record Found(String file, String from, String to, String reason, String sql) {
    }

    private static final String ANY = "*";

    static Stream<StateColumn> stateColumns() {
        return Stream.of(
                new StateColumn(
                        "practices", "PracticeEntity", "stage", List.of("close_reason", "closeReason"), Map.of(),
                        "feature/practice/adapter/db/PostgresPracticeStageTransitions.java", List.of(),
                        Arrays.stream(PracticeStageTransition.values())
                                .map(transition -> new Allowed(
                                        transition.name(), transition.from(), transition.to(), transition.closeReason()))
                                .toList()),
                new StateColumn(
                        "ai_jobs", "AiJobEntity", "status", List.of(), Map.of(),
                        "platform/operation/PostgresAiJobLedger.java", List.of(),
                        Arrays.stream(AiJobStatusTransition.values())
                                .map(transition -> new Allowed(transition.name(), transition.from(), transition.to(), null))
                                .toList()),
                new StateColumn(
                        "users", "UserEntity", "status", List.of(), Map.of("deactivated", List.of("deactivated")),
                        "feature/auth/adapter/db/PostgresAccountDeactivation.java", List.of(),
                        Arrays.stream(UserStatusTransition.values())
                                .map(transition -> new Allowed(transition.name(), transition.from(), transition.to(), null))
                                .toList()),
                new StateColumn(
                        "billing_subscriptions", "BillingSubscriptionEntity", "status", List.of(), Map.of(),
                        "feature/billing/adapter/db/PostgresBillingStatusTransitions.java",
                        // 스토어 구독의 upsert. 활성 계정인지 보려고 users 를 함께 읽는 한 문장이라 그 조회가 있는 저장소에 남는다.
                        List.of("feature/billing/adapter/db/PostgresBillingRepository.java"),
                        Arrays.stream(SubscriptionStatusTransition.values())
                                .map(transition -> new Allowed(transition.name(), transition.from(), transition.to(), null))
                                .toList()),
                new StateColumn(
                        "billing_checkouts", "BillingCheckoutEntity", "status", List.of(),
                        // 콜백의 결과를 적는 닫기 한 문장(finishCheckout).
                        Map.of("status", List.of("done", "failed", "unknown", "canceled")),
                        "feature/billing/adapter/db/PostgresBillingStatusTransitions.java", List.of(),
                        Arrays.stream(CheckoutStatusTransition.values())
                                .map(transition -> new Allowed(transition.name(), transition.from(), transition.to(), null))
                                .toList()));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("stateColumns")
    @DisplayName("상태를 바꾸는 UPDATE 는 그 상태의 파일에만 있고, 문장마다 허용 전이 표의 한 줄이며, 표의 줄마다 문장이 있다")
    void everyStateChangeIsAnAllowedTransitionInItsHomeFile(StateColumn state) {
        List<Found> found = updatesOf(state);
        assertThat(found).as("찾은 문장이 없으면 아래 검사가 조용히 통과한다").hasSizeGreaterThanOrEqualTo(state.allowed().size());

        assertThat(found.stream().filter(update -> !update.to().equals(ANY))
                .filter(update -> !update.file().equals(state.home())).map(Found::file).distinct())
                .as("%s 를 바꾸는 문장이 %s 밖에 있다. 그 파일로 옮기고 허용 전이 표에 있는 길인지 본다", state, state.home())
                .isEmpty();
        assertThat(found.stream().filter(update -> update.to().equals(ANY))
                .filter(update -> !state.syncFiles().contains(update.file())).map(Found::file).distinct())
                .as("%s 를 받아 적는 upsert 가 적어 둔 파일(%s) 밖에 있다", state, state.syncFiles())
                .isEmpty();
        for (Found update : found) {
            if (update.to().equals(ANY)) {
                continue;
            }
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

    /** {@code src/main} 의 모든 문자열에서 이 칸을 SET 하는 UPDATE 와, 이 칸을 받아 적는 upsert 를 찾는다. */
    private static List<Found> updatesOf(StateColumn state) {
        String tableOrEntity = "(?:" + state.table() + "|" + state.entity().toLowerCase(Locale.ROOT) + ")";
        Pattern update = Pattern.compile("\\bupdate " + tableOrEntity + "\\b(?: \\w+)? set (.+?)(?: where (.+))?$");
        Pattern upsert = Pattern.compile("\\binsert into " + tableOrEntity + "\\b.* on conflict .*\\bdo update set (.+?)(?: where (.+))?$");
        // 같은 상태로 남기는 갈래가 있는 CASE: case when status = 'canceled' then 'canceled' else 'active' end 는 active 로 가는 길이다.
        String keeping = "case when (?:\\w+\\.)?" + state.column() + " ?= ?'(\\w+)' then '\\1' else '(\\w+)' end";
        Pattern target = Pattern.compile(
                "(?:^|[ ,])(?:\\w+\\.)?" + state.column() + " ?= ?(?:" + keeping + "|'(\\w+)'|:(\\w+)|(\\S+))");
        Pattern condition = Pattern.compile("(?:^|[ (])(?:\\w+\\.)?" + state.column() + " ?= ?'(\\w+)'");
        Pattern reason = state.reasonColumns().isEmpty() ? null : Pattern.compile("(?:^|[ ,])(?:\\w+\\.)?(?:"
                + String.join("|", state.reasonColumns()).toLowerCase(Locale.ROOT) + ") ?= ?(?:'(\\w+)'|null)");
        List<Found> found = new ArrayList<>();
        try (Stream<Path> files = Files.walk(JAVA_ROOT)) {
            for (Path file : files.filter(path -> path.toString().endsWith(".java")).sorted().toList()) {
                for (String literal : TableOwnerTest.literals(Files.readString(file))) {
                    String sql = literal.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
                    Matcher synced = upsert.matcher(sql);
                    boolean sync = synced.find();
                    Matcher statement = sync ? synced : update.matcher(sql);
                    if (!sync && !statement.find()) {
                        continue;
                    }
                    Matcher to = target.matcher(statement.group(1));
                    if (!to.find()) {
                        continue;
                    }
                    String path = JAVA_ROOT.relativize(file).toString();
                    if (sync) {
                        found.add(new Found(path, null, ANY, null, sql));
                        continue;
                    }
                    List<String> values = to.group(2) != null ? List.of(to.group(2))
                            : to.group(3) != null ? List.of(to.group(3))
                            : to.group(4) != null ? state.parameters().get(to.group(4))
                            : null;
                    assertThat(values)
                            .as("%s 에 무엇을 적는지 문장에서 읽히지 않는다. 값을 글자 그대로 적거나 매개변수의 값을 이 테스트에 적는다:%n%s",
                                    state, sql)
                            .isNotNull();
                    Matcher why = reason == null ? null : reason.matcher(statement.group(1));
                    Matcher from = condition.matcher(statement.group(2) == null ? "" : statement.group(2));
                    String fromValue = from.find() ? from.group(1) : null;
                    String reasonValue = why != null && why.find() ? why.group(1) : null;
                    for (String value : values) {
                        found.add(new Found(path, fromValue, value, reasonValue, sql));
                    }
                }
            }
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        }
        return found;
    }
}
