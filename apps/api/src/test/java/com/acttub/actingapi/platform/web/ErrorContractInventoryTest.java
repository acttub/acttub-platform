package com.acttub.actingapi.platform.web;

import static java.util.Map.entry;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;

/**
 * 오류 계약의 드리프트 방어선.
 *
 * <p><b>계약 하네스의 {@code --check-manifest} 를 옮겨 온 것이다</b>(SOMA-403 2단계). 하네스는
 * 파이썬 소스에서 오류 발생 지점을 뽑아 실행 manifest 와 대조하고, <b>연결되지 않은 지점이 하나라도
 * 있으면 실패했다.</b> 그 하네스는 4단계에서 사라졌으므로 <b>지금 이 방어선은 여기 하나뿐이다</b> —
 * 이 표가 느슨해지면 새 오류를 테스트 없이 넣어도 아무도 모르게 된다.
 *
 * <p>표에 없는 {@code new ApiException} 이 생기면 {@link #everySiteInTheSourceIsInTheTable} 이,
 * 사라진 지점이 표에 남아 있으면 {@link #everyRowStillExistsInTheSource} 가, 커버한다고 적어 둔
 * 테스트가 없어지면 {@link #everyNamedTestClassExists} 가 실패한다.
 *
 * <h2>이 검사가 보지 못하는 것</h2>
 *
 * <ul>
 *   <li><b>호출이 빠진 것</b> — {@code AuthenticatedUser.requireUsable} 처럼 한 자리에서 만든
 *       예외를 여러 경로가 부를 때, 한 경로가 부르기를 그만두어도 지점 수는 그대로다. 그래서
 *       경로별 단언이 따로 필요하다({@code AccountStatusContractIT} 가 그 이유를 적어 두었다).
 *   <li><b>같은 예외를 만드는 헬퍼</b> — {@code CommunityService.postNotFound()} 는 소스에
 *       {@code new} 가 하나지만 그것을 부르는 연산은 일곱이다.
 *   <li><b>422 검증 오류</b> — {@code ApiValidationException} 과 Bean Validation 메시지는
 *       상수가 어노테이션 기본값이나 호출 인자 안에 흩어져 있어 표로 세지 않는다. 지키는 것은
 *       {@code ValidationErrorContractIT}(형상 + 실물 {@code value must not be blank}) ·
 *       {@code CoachReportEndpointIT}({@code rebuttal_text …}) · {@code ProfileEndpointIT}
 *       ({@code nickname …}) · {@code PracticeSessionEndpointIT}({@code sub_branch …}) 다.
 * </ul>
 *
 * <p>표는 {@code new ApiException} 과, {@code ApiErrorAdvice} 가 예외를 거치지 않고 응답을 직접
 * 만드는 {@code return body(…)} 를 함께 센다. 후자를 빼면 <b>503 {@code storage_not_configured}
 * 가 검사 밖에 남는다</b> — 그 자리는 스토리지가 없는 기동에서만 드러나 평소에는 보이지 않는다.
 */
class ErrorContractInventoryTest {

    private static final Path SOURCE_ROOT = Path.of("src/main/java");
    private static final String PACKAGE_PREFIX = "com.acttub.actingapi.";

    /** 예외를 거치지 않고 응답을 직접 만드는 유일한 자리. */
    private static final String ADVICE = "platform.web.ApiErrorAdvice";

    /** detail 이 리터럴이 아닌 지점(예: {@code exception.getMessage()})의 표기. */
    private static final String DYNAMIC = "<동적>";

    private record Coverage(int occurrences, String testClass, String exclusion) {
    }

    /**
     * 지점 → 그것을 지키는 테스트. 키는 {@code 소유 클래스|상태코드|detail} 이고, 값의
     * {@code occurrences} 는 <b>그 클래스가 그 예외를 직접 만드는 횟수</b>다.
     *
     * <p>📌 <b>횟수를 세는 이유</b> — 한 연산이 던지던 것을 둘이 던지게 되면 뜻이 갈린다. 실제로
     * 이관 중에 500 이던 자리가 404 로 바뀐 사고가 둘 있었고, 그때 응답 diff 는 0 이었다.
     */
    private static final Map<String, Coverage> EXPECTED = Map.ofEntries(
            covered("feature.admin.adapter.web.AdminController|401|Unauthorized", 1,
                    "feature.admin.AdminEndpointIT"),
            covered("feature.admissions.app.AdmissionsService|404|university_not_found", 1,
                    "feature.admissions.AdmissionsEndpointIT"),

            covered("feature.auth.adapter.web.AuthController|429|rate limit exceeded", 2,
                    "platform.security.RateLimitContractIT"),
            covered("feature.auth.app.AuthService|400|unsupported_provider", 1,
                    "platform.web.AuthErrorContractIT"),
            covered("feature.auth.app.AuthService|401|invalid_provider_token", 1,
                    "platform.web.AuthErrorContractIT"),
            covered("feature.auth.app.AuthService|401|invalid_refresh_token", 1,
                    "platform.web.AuthErrorContractIT"),
            covered("feature.auth.app.AuthService|409|account_exists_with_different_provider", 1,
                    "feature.auth.AccountStatusContractIT"),
            covered("feature.auth.app.AuthService|503|provider_not_configured", 1,
                    "platform.web.AuthErrorContractIT"),

            covered("feature.coach.app.CoachService|404|practice session not found", 2,
                    "feature.coach.adapter.web.CoachReportEndpointIT"),
            covered("feature.coach.app.CoachService|404|session not found", 3,
                    "feature.coach.app.CoachServiceTest"),
            covered("feature.coach.app.CoachService|409|practice session analysis is not settled", 1,
                    "feature.coach.adapter.web.CoachReportEndpointIT"),
            covered("feature.coach.app.CoachService|409|report already exists", 1,
                    "feature.coach.adapter.web.CoachReportEndpointIT"),
            covered("feature.coach.app.CoachService|409|report already exists for practice session",
                    2, "feature.coach.adapter.web.CoachReportEndpointIT"),
            covered("feature.coach.app.CoachService|409|request is still processing", 3,
                    "feature.coach.adapter.web.CoachReportEndpointIT"),
            covered("feature.coach.app.CoachService|409|session changed concurrently", 1,
                    "feature.coach.app.CoachServiceTest"),
            covered("feature.coach.app.CoachService|409|session is closed", 1,
                    "feature.coach.adapter.web.CoachReportEndpointIT"),
            covered("feature.coach.app.CoachService|502|" + DYNAMIC, 3,
                    "feature.coach.app.CoachServiceTest"),

            covered("feature.community.app.CommunityService|400|cannot_block_self", 1,
                    "feature.community.CommunityErrorContractIT"),
            covered("feature.community.app.CommunityService|400|cannot_report_own", 1,
                    "feature.community.CommunityErrorContractIT"),
            covered("feature.community.app.CommunityService|400|invalid_cursor", 2,
                    "feature.community.CommunityErrorContractIT"),
            covered("feature.community.app.CommunityService|403|not_author", 1,
                    "feature.community.CommunityErrorContractIT"),
            covered("feature.community.app.CommunityService|404|category_not_found", 1,
                    "feature.community.CommunityErrorContractIT"),
            covered("feature.community.app.CommunityService|404|comment_not_found", 1,
                    "feature.community.CommunityErrorContractIT"),
            covered("feature.community.app.CommunityService|404|post_not_found", 1,
                    "feature.community.CommunityErrorContractIT"),
            covered("feature.community.app.CommunityService|404|target_not_found", 1,
                    "feature.community.CommunityErrorContractIT"),
            covered("feature.community.app.CommunityService|404|user_not_found", 1,
                    "feature.community.CommunityErrorContractIT"),
            covered("feature.community.app.CommunityService|409|already_reported", 1,
                    "feature.community.CommunityErrorContractIT"),

            covered("feature.consent.app.ConsentService|404|consent_document_not_found", 1,
                    "feature.consent.ConsentEndpointIT"),
            covered("feature.consent.app.ConsentService|409|required_consent_cannot_be_declined", 1,
                    "feature.consent.ConsentEndpointIT"),

            covered("feature.practice.adapter.web.PracticeSessionController|422|invalid X-Request-Id",
                    1, "feature.practice.PracticeSessionEndpointIT"),
            covered("feature.practice.app.PracticeSessionService|404|practice_session_not_found", 5,
                    "feature.practice.PracticeSessionEndpointIT"),
            covered("feature.practice.app.PracticeSessionService|404|upload_intent_not_found", 1,
                    "feature.practice.PracticeSessionEndpointIT"),
            covered("feature.practice.app.PracticeSessionService|409|analysis_retry_exhausted", 1,
                    "feature.practice.PracticeSessionEndpointIT"),
            covered("feature.practice.app.PracticeSessionService|409|session_is_not_failed", 1,
                    "feature.practice.PracticeSessionEndpointIT"),
            covered("feature.practice.app.PracticeSessionService|409|upload_intent_not_finalized", 1,
                    "feature.practice.PracticeSessionEndpointIT"),
            covered("feature.practice.app.PracticeSessionService|422|request_fingerprint_mismatch", 1,
                    "feature.practice.PracticeSessionEndpointIT"),
            excluded("feature.practice.app.PracticeSessionService|409|invalid_operation_state", 1,
                    "operation 상태 넷(pending·running·succeeded·failed)이 모두 앞 분기에서 "
                            + "처리되므로 도달할 수 없는 방어 코드다. 하네스도 같은 사유로 제외했다."),

            excluded("feature.profile.app.ProfileService|404|user_not_found", 1,
                    "인증 의존성이 이미 유저를 읽은 뒤라, 같은 요청 안에서 유저가 사라져야 도달한다. "
                            + "API 만으로는 만들 수 없다. 하네스도 같은 사유로 제외했다."),

            covered("feature.report.app.ReportService|404|report_not_found", 1,
                    "feature.report.adapter.web.ReportEndpointIT"),
            covered("feature.report.app.ReportService|404|session not found", 1,
                    "feature.coach.adapter.web.CoachReportEndpointIT"),
            covered("feature.report.app.ReportService|409|report already exists", 1,
                    "feature.coach.adapter.web.CoachReportEndpointIT"),
            covered("feature.report.app.ReportService|409|request is still processing", 1,
                    "feature.coach.adapter.web.CoachReportEndpointIT"),
            covered("feature.report.app.ReportService|502|" + DYNAMIC, 1,
                    "feature.coach.adapter.web.CoachReportEndpointIT"),

            covered("feature.upload.app.UploadService|404|upload_intent_not_found", 1,
                    "feature.upload.UploadEndpointIT"),
            covered("feature.upload.app.UploadService|409|upload_intent_expired", 2,
                    "feature.upload.UploadEndpointIT"),
            covered("feature.upload.app.UploadService|409|upload_not_found", 1,
                    "feature.upload.UploadEndpointIT"),
            covered("feature.upload.app.UploadService|409|upload_size_mismatch", 1,
                    "feature.upload.UploadEndpointIT"),
            covered("feature.upload.app.UploadService|413|upload_too_large", 2,
                    "feature.upload.UploadEndpointIT"),
            covered("feature.upload.app.UploadService|415|unsupported_media_type", 1,
                    "feature.upload.UploadEndpointIT"),

            covered("platform.operation.SyncOperationService|409|request is still processing", 1,
                    "feature.coach.adapter.web.CoachReportEndpointIT"),
            covered("platform.operation.SyncOperationService|409|request retry exhausted", 1,
                    "feature.coach.adapter.web.CoachReportEndpointIT"),
            covered("platform.operation.SyncOperationService|422|invalid X-Request-Id", 1,
                    "feature.practice.PracticeSessionEndpointIT"),
            covered("platform.operation.SyncOperationService|422|request_fingerprint_mismatch", 1,
                    "feature.practice.PracticeSessionEndpointIT"),

            covered("platform.security.AccessGate|403|consent_required", 1,
                    "feature.upload.UploadEndpointIT"),
            covered("platform.security.AccessGate|403|consent_blocked", 1,
                    "feature.consent.ConsentEndpointIT"),
            covered("platform.security.AccessGate|429|rate limit exceeded", 1,
                    "platform.security.RateLimitContractIT"),
            covered("platform.security.AuthenticatedUser|403|account_deactivated", 1,
                    "feature.auth.AccountStatusContractIT"),
            covered("platform.security.CurrentUserService|401|invalid or missing access token", 3,
                    "platform.web.AuthErrorContractIT"),

            // advice 가 예외를 거치지 않고 직접 만드는 넷. 500 은 미처리 예외의 계약 모양이고,
            // 503 은 스토리지 자격증명이 없을 때 세 경로에서 난다. 404·405 는 Spring 표준 예외를
            // FastAPI 표기로 옮긴 것이다.
            covered(ADVICE + "|404|Not Found", 1, "platform.web.AuthErrorContractIT"),
            covered(ADVICE + "|405|Method Not Allowed", 1, "platform.web.AuthErrorContractIT"),
            covered(ADVICE + "|500|internal_server_error", 1,
                    "platform.web.ApiErrorAdviceTest"),
            covered(ADVICE + "|503|storage_not_configured", 1,
                    "feature.report.adapter.web.ReportNoStorageIT"));

    @Test
    void everySiteInTheSourceIsInTheTable() {
        Map<String, Integer> actual = scanSourceTree();

        List<String> unlisted = actual.keySet().stream()
                .filter(site -> !EXPECTED.containsKey(site))
                .sorted()
                .toList();
        assertThat(unlisted)
                .as("표에 없는 오류 지점이다. 이 응답을 단언하는 테스트를 만들고 표에 적어라")
                .isEmpty();

        List<String> miscounted = actual.entrySet().stream()
                .filter(found -> EXPECTED.get(found.getKey()).occurrences()
                        != found.getValue())
                .map(found -> "%s: 표 %d 회 · 실제 %d 회".formatted(
                        found.getKey(),
                        EXPECTED.get(found.getKey()).occurrences(),
                        found.getValue()))
                .sorted()
                .toList();
        assertThat(miscounted)
                .as("한 연산이 던지던 것을 둘이 던지면 뜻이 갈린다. 늘어난 자리를 확인하고 표를 고쳐라")
                .isEmpty();
    }

    @Test
    void everyRowStillExistsInTheSource() {
        Map<String, Integer> actual = scanSourceTree();

        assertThat(EXPECTED.keySet().stream().filter(site -> !actual.containsKey(site)).sorted())
                .as("소스에서 사라진 지점이 표에 남아 있다. 그 계약이 정말 없어진 것인지 보고 지워라")
                .isEmpty();
    }

    @Test
    void everyNamedTestClassExists() throws Exception {
        for (Map.Entry<String, Coverage> row : EXPECTED.entrySet()) {
            String testClass = row.getValue().testClass();
            if (testClass == null) {
                assertThat(row.getValue().exclusion())
                        .as("%s 는 커버도 제외 사유도 없다", row.getKey())
                        .isNotBlank();
                continue;
            }
            assertThat(Class.forName(PACKAGE_PREFIX + testClass))
                    .as("%s 가 가리키는 테스트", row.getKey())
                    .isNotNull();
        }
    }

    /**
     * 검사기 자신을 반증한다.
     *
     * <p><b>통과할 수 있는 검사는 통과하지 못하는 경우도 보여야 판정으로 쓸 수 있다.</b> 스캐너가
     * 아무것도 못 찾는 상태여도 위의 셋은 전부 초록이므로(표에 없는 것 0 · 사라진 것은 잡히지만
     * 그건 다른 실패다), 여기서 <b>실제로 일어날 형태의 소스</b>를 주어 무엇을 잡고 무엇을 흘리는지
     * 못박는다.
     */
    @Test
    void theScannerReadsTheFormsThatActuallyOccur() {
        String source = """
                class Sample {
                    // 주석 안의 new ApiException(999, "주석") 은 세지 않는다
                    /* 블록 주석의 new ApiException(998, "블록") 도 마찬가지 */
                    void one() {
                        throw new ApiException(404, "post_not_found");
                    }
                    void two() {
                        throw new ApiException(
                                409,
                                "request is still processing",
                                Map.of("X-Request-Id", requestId.toString()));
                    }
                    void three() { throw new ApiException(502, exception.getMessage()); }
                    void four() { throw new ApiException(400, "괄호 ) 와 쉼표 , 가 든 문구"); }
                    String five = \"""
                            텍스트 블록 안의 new ApiException(997, "블록문자열")
                            \""";
                }
                """;

        assertThat(scan(source)).containsExactlyInAnyOrder(
                "404|post_not_found",
                "409|request is still processing",
                "502|" + DYNAMIC,
                "400|괄호 ) 와 쉼표 , 가 든 문구");
    }

    /** 소스 전체를 훑어 {@code 소유 클래스|상태|detail} → 횟수를 만든다. */
    private static Map<String, Integer> scanSourceTree() {
        Map<String, Integer> found = new LinkedHashMap<>();
        try (Stream<Path> files = Files.walk(SOURCE_ROOT)) {
            files.filter(path -> path.toString().endsWith(".java")).sorted().forEach(path -> {
                String owner = SOURCE_ROOT.relativize(path).toString()
                        .replace(".java", "")
                        .replace(java.io.File.separatorChar, '.')
                        .replace(PACKAGE_PREFIX, "");
                String text = read(path);
                for (String site : scan(text)) {
                    found.merge(owner + "|" + site, 1, Integer::sum);
                }
                // advice 는 예외를 거치지 않고 응답을 직접 만든다. 마커를 파일 하나로 한정하는
                // 이유는 `body(` 가 흔한 이름이라 다른 곳에서 오탐이 되기 때문이다.
                if (ADVICE.equals(owner)) {
                    for (String site : scan(text, "return body")) {
                        found.merge(owner + "|" + site, 1, Integer::sum);
                    }
                }
            });
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        }
        return found;
    }

    /** 한 파일에서 {@code 상태|detail} 목록을 뽑는다. detail 이 리터럴이 아니면 {@link #DYNAMIC}. */
    private static List<String> scan(String rawSource) {
        return scan(rawSource, "new ApiException");
    }

    private static List<String> scan(String rawSource, String marker) {
        String source = withoutComments(rawSource);
        List<String> sites = new ArrayList<>();
        int cursor = 0;
        while (true) {
            int found = source.indexOf(marker, cursor);
            if (found < 0) {
                return sites;
            }
            int openParen = source.indexOf('(', found + marker.length());
            if (openParen < 0) {
                return sites;
            }
            List<String> arguments = arguments(source, openParen);
            String status = arguments.isEmpty() ? "" : arguments.get(0);
            String detail = arguments.size() > 1 ? arguments.get(1) : "";
            if (status.matches("\\d+")) {
                sites.add(status + "|" + (isStringLiteral(detail) ? unquote(detail) : DYNAMIC));
            }
            cursor = openParen + 1;
        }
    }

    /**
     * 코드가 아닌 것을 지운다 — 주석과 <b>텍스트 블록의 내용</b>이다.
     *
     * <p>한 줄 문자열은 인자 추출에 필요하므로 그대로 두지만, 텍스트 블록은 detail 로 쓰이지 않고
     * <b>SQL 이 잔뜩 들어 있다.</b> 남겨 두면 그 안의 문구가 오류 지점으로 잡힌다 — 이 검사기의
     * 반증 테스트가 실제로 그것을 먼저 잡았다. 빈 문자열로 바꿔 인자 자리는 유지한다.
     */
    private static String withoutComments(String source) {
        StringBuilder out = new StringBuilder(source.length());
        int i = 0;
        while (i < source.length()) {
            if (source.startsWith("\"\"\"", i)) {
                out.append("\"\"");
                i = endOfStringLiteral(source, i);
            } else if (source.charAt(i) == '"') {
                int end = endOfStringLiteral(source, i);
                out.append(source, i, end);
                i = end;
            } else if (source.startsWith("//", i)) {
                int end = source.indexOf('\n', i);
                i = end < 0 ? source.length() : end;
            } else if (source.startsWith("/*", i)) {
                int end = source.indexOf("*/", i + 2);
                i = end < 0 ? source.length() : end + 2;
            } else if (source.charAt(i) == '\'') {
                i = endOfCharLiteral(source, i);
            } else {
                out.append(source.charAt(i));
                i++;
            }
        }
        return out.toString();
    }

    /** 여는 괄호에서 매칭 괄호까지를 최상위 쉼표로 가른다. */
    private static List<String> arguments(String source, int openParen) {
        List<String> parts = new ArrayList<>();
        int depth = 0;
        int start = openParen + 1;
        int i = openParen;
        while (i < source.length()) {
            char c = source.charAt(i);
            if (c == '"') {
                i = endOfStringLiteral(source, i);
                continue;
            }
            if (c == '(' || c == '[' || c == '{') {
                depth++;
            } else if (c == ')' || c == ']' || c == '}') {
                depth--;
                if (depth == 0) {
                    parts.add(source.substring(start, i).trim());
                    return parts;
                }
            } else if (c == ',' && depth == 1) {
                parts.add(source.substring(start, i).trim());
                start = i + 1;
            }
            i++;
        }
        throw new IllegalStateException("괄호가 닫히지 않았다: " + source.substring(openParen,
                Math.min(source.length(), openParen + 80)));
    }

    private static int endOfStringLiteral(String source, int start) {
        if (source.startsWith("\"\"\"", start)) {
            int end = source.indexOf("\"\"\"", start + 3);
            return end < 0 ? source.length() : end + 3;
        }
        int i = start + 1;
        while (i < source.length()) {
            char c = source.charAt(i);
            if (c == '\\') {
                i += 2;
                continue;
            }
            if (c == '"') {
                return i + 1;
            }
            i++;
        }
        return source.length();
    }

    private static int endOfCharLiteral(String source, int start) {
        int i = start + 1;
        while (i < source.length()) {
            char c = source.charAt(i);
            if (c == '\\') {
                i += 2;
                continue;
            }
            if (c == '\'') {
                return i + 1;
            }
            i++;
        }
        return source.length();
    }

    private static boolean isStringLiteral(String argument) {
        return argument.length() >= 2
                && argument.startsWith("\"")
                && argument.endsWith("\"")
                && !argument.startsWith("\"\"\"");
    }

    private static String unquote(String literal) {
        return literal.substring(1, literal.length() - 1)
                .replace("\\\"", "\"")
                .replace("\\\\", "\\");
    }

    private static String read(Path path) {
        try {
            return Files.readString(path);
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        }
    }

    private static Map.Entry<String, Coverage> covered(
            String site, int occurrences, String testClass) {
        return entry(site, new Coverage(occurrences, testClass, null));
    }

    private static Map.Entry<String, Coverage> excluded(
            String site, int occurrences, String reason) {
        return entry(site, new Coverage(occurrences, null, reason));
    }
}
