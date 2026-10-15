package com.acttub.actingapi.feature.coach.app;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * 같은 묶음에서 이어서 찍은 테이크가 지난 회차와 같은 장면인지 코드가 가린다 (SOMA-636).
 *
 * <p>2026-10-15 로컬 재생: 지난 회차 대화를 보여 준 채 모델에게 같은 장면인지 묻자, 아빠에게 대드는 다른 장면을
 * 올렸는데도 지난 대사("포기할래요")가 이번 영상에서도 들렸다고 지어내 같은 장면으로 판단했다(2/2). 그래서 이번 영상의
 * 대사는 지난 정보 없이 따로 받아 적고, 지난 회차 대사와의 비교는 코드가 한다. 확실하지 않으면 다른 장면이다.
 */
public final class ContinuedTake {
    static final String HEARD_KEY = "heard_lines";
    /** 지난 대사가 이번 대사 안에 그대로 들어 있다고 볼 최소 글자 수(공백·부호 뺀 뒤). "포기할래요"가 5자다. */
    static final int MIN_LINE = 5;
    /** 줄 단위로는 안 맞아도 같은 대사로 볼 공통 구간 최소 길이. 긴 독백끼리 우연히 겹치지 않게 넉넉히 둔다. */
    static final int MIN_COMMON = 10;
    /**
     * 장면과 상관없이 셀프테이프 앞뒤에 붙는 말(인사·자기소개·시작/끝 알림). 이 말이 든 줄은 비교에서 뺀다 —
     * 같은 배우가 다른 장면을 찍어도 "안녕하세요", "감사합니다"는 겹친다(2026-10-15 리뷰).
     */
    private static final List<String> SLATE = List.of("안녕하세요", "감사합니다", "고맙습니다", "준비하겠습니다", "준비됐습니다",
            "시작하겠습니다", "시작할게요", "이상입니다", "마치겠습니다", "보여드릴", "보여드리겠습니다", "잘부탁드립니다",
            "재학중", "지원자", "액션", "컷");
    /** 받아 적는 최대 줄 수. 지난 회차 대사가 장면 끝에 있어도 닿게 넉넉히 둔다(2026-10-15 재생: 8줄이면 끝 대사를 놓쳤다). */
    static final int MAX_LINES = 30;
    private static final Pattern QUOTED = Pattern.compile("\"([^\"]+)\"|“([^”]+)”");
    private static final Pattern NOT_TEXT = Pattern.compile("[^\\p{L}\\p{N}]+");

    private ContinuedTake() {}

    /** 지난 정보를 주지 않고 이번 영상의 대사만 받아 적게 하는 지시. */
    static String heardLinesPrompt() {
        return """
                이 영상에서 사람이 실제로 소리 내어 말한 대사를 들린 그대로 받아 적는다.
                처음부터 끝까지 또렷하게 알아들은 말을 한 줄에 한 문장씩, 들린 순서대로 모두 쓴다. 최대 서른 줄이다.
                뜻을 풀거나, 고치거나, 이어질 말을 짐작해 채우지 않는다. 화면의 글자는 적지 않는다.
                말소리가 없거나 알아듣지 못했으면 "없음" 한 줄만 쓴다.
                그 밖에는 한 글자도 쓰지 않는다.
                """;
    }

    /** 받아 적은 답을 줄로 나눈다. "없음"·빈 줄·번호·따옴표는 걷어낸다. 실패(null)는 빈 목록이다. */
    static List<String> parseHeardLines(String reply) {
        List<String> lines = new ArrayList<>();
        if (reply == null) return lines;
        for (String raw : reply.split("\\R")) {
            String line = raw.strip().replaceFirst("^(?:[-*•]|\\d+[.)])\\s*", "").replaceAll("[\"“”]", "").strip();
            if (line.isEmpty() || "없음".equals(line) || line.length() > 200) continue;
            lines.add(line);
            if (lines.size() == MAX_LINES) break;
        }
        return lines;
    }

    /** 이번 대화 상태에 받아 적은 대사를 남긴다. 다음 회차가 이 대사와 비교한다. */
    static void remember(ObjectNode state, List<String> heard) {
        ObjectNode loop = state.path(DirectVideoPracticeLoop.STATE_KEY).isObject()
                ? (ObjectNode) state.get(DirectVideoPracticeLoop.STATE_KEY) : state.putObject(DirectVideoPracticeLoop.STATE_KEY);
        var array = loop.putArray(HEARD_KEY);
        heard.forEach(array::add);
    }

    /**
     * 지난 회차 대화 상태에서 그 회차에 들린 대사를 꺼낸다. 따로 받아 적은 대사가 있으면 그것을, 없으면(이 기능 전 대화)
     * 첫 응답 <설계>의 "확인된 대사" 칸을 쓴다.
     */
    public static List<String> linesFromState(String stateText) {
        List<String> lines = new ArrayList<>();
        if (stateText == null || stateText.isBlank()) return lines;
        JsonNode loop;
        try {
            loop = StructuredJson.MAPPER.readTree(stateText).path(DirectVideoPracticeLoop.STATE_KEY);
        } catch (Exception unreadable) {
            return lines;
        }
        if (loop.path(HEARD_KEY).isArray() && !loop.path(HEARD_KEY).isEmpty()) {
            loop.path(HEARD_KEY).forEach(line -> lines.add(line.asText()));
            return lines;
        }
        for (String row : loop.path("design").asText("").split("\\R")) {
            if (!row.startsWith("확인된 대사:")) continue;
            Matcher quoted = QUOTED.matcher(row);
            while (quoted.find()) lines.add(quoted.group(1) != null ? quoted.group(1) : quoted.group(2));
        }
        return lines;
    }

    /** 지난 회차 대사가 이번 테이크에서 다시 들렸으면 같은 장면이다. 어느 쪽이든 비면 다른 장면으로 본다. */
    static boolean sameScene(List<String> previousRaw, List<String> heardRaw) {
        List<String> previous = scene(previousRaw), heard = scene(heardRaw);
        if (previous.isEmpty() || heard.isEmpty()) return false;
        String heardAll = normalized(String.join(" ", heard));
        String previousAll = normalized(String.join(" ", previous));
        for (String line : previous) {
            String value = normalized(line);
            if (value.length() >= MIN_LINE && heardAll.contains(value)) return true;
        }
        for (String line : heard) {
            String value = normalized(line);
            if (value.length() >= MIN_LINE && previousAll.contains(value)) return true;
        }
        return longestCommon(previousAll, heardAll) >= MIN_COMMON;
    }

    /** 셀프테이프 인사·자기소개 줄과 짧은 줄을 뺀 장면 대사. */
    static List<String> scene(List<String> lines) {
        List<String> kept = new ArrayList<>();
        if (lines == null) return kept;
        for (String line : lines) {
            String value = normalized(line);
            if (value.length() < 2) continue;
            if (SLATE.stream().anyMatch(value::contains)) continue;
            if (value.startsWith("저는") && value.endsWith("입니다")) continue;
            kept.add(line);
        }
        return kept;
    }

    static String normalized(String text) {
        return NOT_TEXT.matcher(Normalizer.normalize(text == null ? "" : text, Normalizer.Form.NFC).toLowerCase()).replaceAll("");
    }

    private static int longestCommon(String a, String b) {
        int best = 0;
        int[] previous = new int[b.length() + 1];
        for (int i = 1; i <= a.length(); i++) {
            int[] current = new int[b.length() + 1];
            for (int j = 1; j <= b.length(); j++) {
                if (a.charAt(i - 1) == b.charAt(j - 1)) {
                    current[j] = previous[j - 1] + 1;
                    best = Math.max(best, current[j]);
                }
            }
            previous = current;
        }
        return best;
    }
}
