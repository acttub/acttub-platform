package com.acttub.actingapi.feature.coach.app;

import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.coach.domain.ClosingIntent;
import com.fasterxml.jackson.databind.JsonNode;

/**
 * 배우.md — 같은 배우가 최근 연습 루프 대화에서 <b>직접 한 말</b>을 연습 루프 코치에게 넘기는 칸.
 *
 * <p>중심은 배우의 답이다. 이 배우가 코치에게 무엇을 바랐는지(평가·방법·보는 쪽), 무엇을 아니라고 했는지,
 * 자기에 대해 무엇이라 했는지를 원문 그대로 옮긴다. 코치가 짚은 버릇과 제안은 같은 말을 되풀이하지 않게
 * 하는 참고로 맨 뒤에 둔다.
 *
 * <p>모델 호출이 없다. 분류는 그 대화의 숨은 상태 칸({@code 배우의 말})이 이미 정해 둔 것을 읽고, 상태 칸이
 * 없던 옛 대화에서만 요청을 나타내는 낱말로 바란 것을 고른다. 배우가 기억을 고칠 화면이 없으므로 요약·추론을
 * 넣지 않는 것이 이 칸의 안전판이다. 상한을 넘으면 뒤(코치가 짚은 것)부터 줄 단위로 빠진다.
 */
final class PracticeLoopMemory {

    private PracticeLoopMemory() {}

    /** 프롬프트에 넣는 이 칸의 상한(코드포인트). 기존 기억 칸(1,200자)과 따로 센다. */
    static final int MAX_CHARS = 900;
    private static final int QUOTE_MAX = 80;
    private static final int PER_SECTION = 3;
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("M/d HH:mm");

    /** 상태 칸이 없던 옛 대화에서 배우가 코치에게 무언가를 청한 말. */
    private static final Pattern WANT = Pattern.compile(
            "(?i)(평가|피드백|분석|방법|예시|어떻게\\s*(?:해|하|고치)|봐\\s*(?:줘|주|달)|짚어|알려|단점|장점|부족"
                    + "|feedback|how (?:do|should|can) i|what should i|give me|director|example)");

    /**
     * 최근 대화들(최신이 앞)에서 배우.md 칸을 만든다. 남길 것이 없으면 빈 문자열 — 빈 제목만 남기면 모델이
     * 그 자리를 지어내 채운다.
     */
    static String block(List<PastPracticeLoop> past) {
        if (past == null || past.isEmpty()) return "";
        List<String> wants = new ArrayList<>();
        List<String> denied = new ArrayList<>();
        List<String> self = new ArrayList<>();
        List<String> coach = new ArrayList<>();
        Set<String> avoid = new LinkedHashSet<>();
        // 같은 말을 되풀이한 것("표정 위주로 봐달라고요!!!" 두 번)은 한 번만 싣는다.
        Set<String> seen = new java.util.HashSet<>();
        int evaluation = 0;
        int method = 0;
        int pushback = 0;
        int practices = 0;
        for (PastPracticeLoop practice : past) {
            JsonNode loop = practice.loopState();
            if (loop == null || !loop.isObject()) continue;
            practices++;
            String day = practice.createdAt() == null ? "" : DAY.format(practice.createdAt().atZone(SEOUL));
            String design = loop.path("design").asText("");
            JsonNode statuses = loop.path("statuses");
            String habit = DirectVideoPracticeLoop.habit(design);
            List<String> localWants = new ArrayList<>();
            List<String> localDenied = new ArrayList<>();
            List<String> localSelf = new ArrayList<>();
            int coachIndex = 0;
            String lastAction = "";
            for (PastPracticeLoop.Turn turn : practice.turns()) {
                if ("ai".equals(turn.role())) {
                    lastAction = DirectVideoPracticeLoop.action(status(statuses, coachIndex++));
                    continue;
                }
                String text = turn.text() == null ? "" : turn.text().strip();
                if (text.isEmpty() || DirectVideoPracticeLoop.VAGUE.matcher(text).matches()
                        || ClosingIntent.isClosing(text)) continue;
                if (!seen.add(text.replaceAll("[\\s!?.~…ㅠㅜ]+", ""))) continue;
                // 이 말을 받은 다음 코치 턴의 상태 칸이 배우의 말을 분류해 두었다.
                String kind = DirectVideoPracticeLoop.statusField(status(statuses, coachIndex), "배우의 말");
                String quote = day + ": \"" + clip(text, QUOTE_MAX) + "\"";
                if (kind.startsWith("정정")) {
                    localDenied.add(day + (habit.isBlank() ? "" : " (코치가 본 것: " + clip(habit, 40) + ")")
                            + ": \"" + clip(text, QUOTE_MAX) + "\"");
                } else if (kind.startsWith("평가 요청")) {
                    evaluation++;
                    localWants.add(quote);
                } else if (kind.startsWith("방법 요청")) {
                    method++;
                    localWants.add(quote);
                } else if (kind.startsWith("반박")) {
                    pushback++;
                    localWants.add(quote);
                } else if (kind.startsWith("자기 한 줄") || kind.startsWith("선택 설명")
                        || kind.startsWith("스스로 알아챔") || lastAction.startsWith("마무리1")) {
                    localSelf.add(quote);
                } else if (kind.isEmpty() && WANT.matcher(text).find()) {
                    localWants.add(quote);
                }
            }
            // 대화 안에서는 시간순이다. 최신이 앞에 오도록 뒤집어 붙인다.
            Collections.reverse(localWants);
            Collections.reverse(localDenied);
            Collections.reverse(localSelf);
            wants.addAll(localWants);
            denied.addAll(localDenied);
            self.addAll(localSelf);
            for (String topic : lastAvoid(statuses).split("[,·/]")) {
                String value = topic.strip();
                if (!value.isEmpty() && !value.startsWith("없음")) avoid.add(clip(value, 30));
            }
            if (!habit.isBlank()) {
                String next = practice.nextTake() == null ? "" : practice.nextTake().strip();
                coach.add(day + ": " + clip(habit, 40) + (next.isEmpty() ? "" : " — 제안: " + clip(next, 60)));
            }
        }
        if (wants.isEmpty() && denied.isEmpty() && self.isEmpty() && avoid.isEmpty() && coach.isEmpty()) return "";

        List<String> lines = new ArrayList<>();
        lines.add("## 배우가 지난 연습에서 직접 한 말");
        lines.add("최근 연습 대화에서 배우가 쓴 말을 그대로 옮겼다. 이 배우가 코치에게 무엇을 바라는지 알고 대화를"
                + " 맞추는 데 쓴다. **영상 근거가 아니다.** 배우의 말을 그대로 읊지 않는다.");
        if (!wants.isEmpty()) {
            lines.add("");
            lines.add("### 배우가 바란 것");
            List<String> counts = new ArrayList<>();
            if (evaluation > 0) counts.add("평가 요청 " + evaluation + "번");
            if (method > 0) counts.add("방법·예시 요청 " + method + "번");
            if (pushback > 0) counts.add("보는 방식에 대한 이의 " + pushback + "번");
            if (!counts.isEmpty()) lines.add("- 최근 연습 " + practices + "개에서: " + String.join(", ", counts));
            wants.stream().limit(PER_SECTION).forEach(line -> lines.add("- " + line));
        }
        if (!denied.isEmpty() || !avoid.isEmpty()) {
            lines.add("");
            lines.add("### 배우가 아니라고 한 것");
            denied.stream().limit(PER_SECTION).forEach(line -> lines.add("- " + line));
            if (!avoid.isEmpty()) lines.add("- 다시 꺼내지 않을 주제: " + String.join(", ", avoid));
        }
        if (!self.isEmpty()) {
            lines.add("");
            lines.add("### 배우가 자기에 대해 한 말");
            self.stream().limit(PER_SECTION).forEach(line -> lines.add("- " + line));
        }
        if (!coach.isEmpty()) {
            lines.add("");
            lines.add("### 코치가 지난번에 짚은 것");
            coach.stream().limit(PER_SECTION).forEach(line -> lines.add("- " + line));
        }
        // 상한을 넘으면 뒤(코치가 짚은 것)부터 줄 단위로 덜어 낸다. 줄 가운데서 자르지 않는다.
        while (lines.size() > 2 && length(String.join("\n", lines)) > MAX_CHARS) lines.removeLast();
        while (!lines.isEmpty() && (lines.getLast().isBlank() || lines.getLast().startsWith("### "))) lines.removeLast();
        return String.join("\n", lines) + "\n\n";
    }

    private static String status(JsonNode statuses, int index) {
        return statuses == null || !statuses.isArray() ? "" : statuses.path(index).asText("");
    }

    /** 대화의 마지막 상태 칸들 중 가장 최근에 적힌 피할 것. 없거나 "없음"이면 빈 문자열. */
    private static String lastAvoid(JsonNode statuses) {
        if (statuses == null || !statuses.isArray()) return "";
        for (int i = statuses.size() - 1; i >= 0; i--) {
            String value = DirectVideoPracticeLoop.statusField(statuses.get(i).asText(""), "피할 것");
            if (!value.isEmpty() && !value.startsWith("없음")) return value;
        }
        return "";
    }

    private static int length(String text) {
        return text.codePointCount(0, text.length());
    }

    /** 코드포인트 기준으로 자르고 말줄임표를 붙인다. 줄바꿈은 한 칸으로 편다. */
    private static String clip(String text, int max) {
        String value = text.strip();
        value = value.replaceAll("\\s*\\n\\s*", " ");
        if (value.codePointCount(0, value.length()) <= max) return value;
        return value.substring(0, value.offsetByCodePoints(0, max)).stripTrailing() + "…";
    }
}
