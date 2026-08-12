package com.acttub.actingapi.coach;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/** acting-llm의 금지어·시각·가시 길이 검증 계약. */
public final class CoachValidator {

    public static final String SAFE_RUNTIME_REPLACEMENT =
            "이 문장은 지금 보여드리지 않고, 더 안전한 방식으로 다시 바꿔볼게요.";

    private static final int UNICODE = Pattern.UNICODE_CHARACTER_CLASS;

    private static final List<String> VALIDATION_KEYS = List.of(
            "sentence_limit", "forbidden_language", "timecode");

    private static final List<Pattern> TIMECODE_PATTERNS = List.of(
            Pattern.compile("[0-9]{1,2}\\s*:\\s*[0-9]{2}", UNICODE),
            Pattern.compile("[0-9]+\\s*초\\s*(?:에서|부터|~|-|–)\\s*[0-9]+\\s*초", UNICODE),
            Pattern.compile("[0-9]+\\s*[~\\-–]\\s*[0-9]+\\s*초", UNICODE),
            Pattern.compile("[0-9]+\\s*초\\s*(?:에|에선|에서|쯤|즈음|구간|사이|부분|지점|무렵)", UNICODE),
            Pattern.compile("[0-9]+\\s*분\\s*[0-9]+\\s*초", UNICODE));

    private static final List<String> LITERAL_FORBIDDEN = List.of(
            "점수",
            "등급",
            "랭킹",
            "점 만점",
            "합격",
            "캐스팅 적합",
            "강점",
            "약점",
            "개선점",
            "몰입이 부족",
            "집중력이 부족",
            "감정이 부족",
            "표현력이 부족",
            "실력이 부족",
            "연기가 부족",
            "잘함",
            "못함",
            "진정성",
            "감정 전달력",
            "몰입도",
            "자연스러움",
            "감정이 얕",
            "더 깊게 느껴",
            "더 자연스럽게",
            "진심으로",
            "감정을 담아",
            "믿고 한 번 더",
            "집중력이 부족",
            "blockage_type",
            "exercise_code",
            "instruction_level",
            "ANALYSIS",
            "EXPRESSION",
            "PROBE",
            "리포트",
            "4축",
            "이해했어요?");

    private static final List<ForbiddenPattern> REGEX_FORBIDDEN = List.of(
            new ForbiddenPattern(
                    "배우 책임 전가",
                    Pattern.compile(
                            "배우님이[^.!?\\n]{0,40}해서\\s*그래요",
                            Pattern.CASE_INSENSITIVE | UNICODE)),
            new ForbiddenPattern(
                    "개인 상처 소환",
                    Pattern.compile(
                            "(실제|본인|개인적인?)\\s*(어머니|아버지|가족|상처|트라우마).{0,18}(떠올|생각해)",
                            Pattern.CASE_INSENSITIVE | UNICODE)),
            new ForbiddenPattern(
                    "정신상태 단정",
                    Pattern.compile(
                            "(정신상태|성격|트라우마).{0,12}(입니다|이에요|예요|때문)",
                            Pattern.CASE_INSENSITIVE | UNICODE)));

    private static final Pattern WHITESPACE =
            Pattern.compile("\\s+", Pattern.UNICODE_CHARACTER_CLASS);

    private CoachValidator() {
    }

    public static List<String> scanForbidden(String text) {
        String normalized = Normalizer.normalize(text, Normalizer.Form.NFKC);
        String lowered = normalized.toLowerCase(Locale.ROOT);
        LinkedHashSet<String> hits = new LinkedHashSet<>();
        for (String term : LITERAL_FORBIDDEN) {
            if (lowered.contains(term.toLowerCase(Locale.ROOT))) {
                hits.add(term);
            }
        }
        for (ForbiddenPattern forbidden : REGEX_FORBIDDEN) {
            if (forbidden.pattern().matcher(normalized).find()) {
                hits.add(forbidden.label());
            }
        }
        return List.copyOf(hits);
    }

    public static List<String> scanGeneratedStrings(List<String> strings) {
        LinkedHashSet<String> hits = new LinkedHashSet<>();
        strings.forEach(value -> hits.addAll(scanForbidden(value)));
        return List.copyOf(hits);
    }

    public static int visibleLength(String text) {
        String visible = WHITESPACE.matcher(text).replaceAll(" ").strip();
        return visible.codePointCount(0, visible.length());
    }

    public static boolean hasTimecode(String text) {
        return TIMECODE_PATTERNS.stream()
                .anyMatch(pattern -> pattern.matcher(text).find());
    }

    public static CoachValidation validateTurn(
            String visibleMessage, boolean enforceSentenceLimit) {
        List<String> forbiddenHits = scanGeneratedStrings(List.of(visibleMessage));
        int length = visibleLength(visibleMessage);
        LinkedHashMap<String, Boolean> checks = new LinkedHashMap<>();
        checks.put("sentence_limit", !enforceSentenceLimit || length <= 170);
        checks.put("forbidden_language", forbiddenHits.isEmpty());
        checks.put("timecode", !hasTimecode(visibleMessage));

        Map<String, String> labels = Map.of(
                "sentence_limit", "응답이 " + length + "자입니다. 170자 이내여야 합니다.",
                "forbidden_language", "금지어가 노출됐습니다: " + String.join(", ", forbiddenHits),
                "timecode", "응답에 시각이 들어 있습니다. 숫자를 빼고 대사나 동작으로 그 순간을 가리킵니다.");
        List<String> failures = new ArrayList<>();
        for (String key : VALIDATION_KEYS) {
            if (!checks.get(key)) {
                failures.add(labels.get(key));
            }
        }
        return new CoachValidation(checks, failures, forbiddenHits);
    }

    private record ForbiddenPattern(String label, Pattern pattern) {
    }
}
