package com.acttub.actingapi.feature.coach.app;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * 연습 루프 프롬프트({@code practice-loop.txt})의 숨은 칸을 다룬다.
 *
 * <p>모델은 첫 응답에 {@code <설계>}와 {@code <코치>}를, 이후 응답마다 맨 앞에 {@code <상태>} 한 줄을 쓴다.
 * 배우에게는 코치 본문만 저장하고 보여준다. 숨은 칸은 {@code coaching_state.practice_loop}에 두었다가
 * 다음 턴에 모델에 넘기는 대화 기록에만 다시 붙인다 — 모델은 자기 설계와 직전 상태를 보고 다음 단계를 고른다.
 */
final class DirectVideoPracticeLoop {
    static final String STATE_KEY = "practice_loop";
    private static final Pattern DESIGN = Pattern.compile("(?s)<설계>\\s*(.*?)\\s*</설계>");
    private static final Pattern STATUS = Pattern.compile("(?s)<상태>\\s*(.*?)\\s*</상태>");
    private static final Pattern COACH = Pattern.compile("(?s)<코치>\\s*(.*?)\\s*(?:</코치>|$)");
    private static final Pattern STRAY_TAG = Pattern.compile("</?(?:설계|상태|코치)>");
    // 모델이 줄 끝에 남기는 날 자모("알려 주세요.ㄴ" 같은). 실험에서 실제로 나왔고 다음 턴에 그대로 따라 한다.
    private static final Pattern TRAILING_JAMO = Pattern.compile("(?m)(?<=[^\\s\\u3131-\\u318E])[\\u3131-\\u318E]+[ \\t]*$");

    private DirectVideoPracticeLoop() { }

    /** 모델 응답 하나를 숨은 칸과 배우에게 보일 본문으로 나눈 것. 없는 칸은 빈 문자열이다. */
    record Parsed(String design, String status, String message) { }

    static Parsed parse(String raw) {
        String text = raw == null ? "" : raw.strip();
        String design = first(DESIGN, text);
        String status = first(STATUS, text);
        String rest = STATUS.matcher(DESIGN.matcher(text).replaceAll("")).replaceAll("");
        Matcher coach = COACH.matcher(rest);
        String message = coach.find() ? coach.group(1) : rest;
        message = STRAY_TAG.matcher(message).replaceAll("");
        return new Parsed(design, status, TRAILING_JAMO.matcher(message).replaceAll("").strip());
    }

    /** 이 세션이 연습 루프로 시작됐는지. 루프 전에 열린 세션은 기존 경로로 이어간다. */
    static boolean applies(CoachSessionSnapshot session) {
        return session.turns().isEmpty() || session.coachingState() != null
                && session.coachingState().path(STATE_KEY).isObject();
    }

    /** 저장된 표시용 대화에 숨은 칸을 되붙여 모델에 넘길 기록을 만든다. */
    static List<DirectVideoModel.Message> history(List<CoachTurnSnapshot> turns, JsonNode state, String actorText) {
        JsonNode loop = state == null ? null : state.path(STATE_KEY);
        String design = loop == null ? "" : loop.path("design").asText("");
        var history = new ArrayList<DirectVideoModel.Message>();
        int coachIndex = 0;
        for (CoachTurnSnapshot turn : turns) {
            if (!"ai".equals(turn.role())) {
                history.add(new DirectVideoModel.Message("user", turn.text()));
                continue;
            }
            String text = turn.text();
            if (coachIndex == 0 && !design.isBlank()) {
                text = "<설계>\n" + design + "\n</설계>\n<코치>\n" + text + "\n</코치>";
            } else {
                String status = loop == null ? "" : loop.path("statuses").path(coachIndex).asText("");
                if (!status.isBlank()) text = "<상태>" + status + "</상태>\n" + text;
            }
            history.add(new DirectVideoModel.Message("model", text));
            coachIndex++;
        }
        if (actorText != null) history.add(new DirectVideoModel.Message("user", actorText));
        return history;
    }

    /** 이번 응답의 숨은 칸을 상태에 쌓는다. statuses 의 순서는 코치 턴의 순서와 같다. */
    static void remember(ObjectNode state, Parsed parsed) {
        ObjectNode loop = state.path(STATE_KEY).isObject() ? (ObjectNode) state.get(STATE_KEY) : state.putObject(STATE_KEY);
        if (!parsed.design().isBlank() && loop.path("design").asText("").isBlank()) loop.put("design", parsed.design());
        ArrayNode statuses = loop.path("statuses").isArray() ? (ArrayNode) loop.get("statuses") : loop.putArray("statuses");
        statuses.add(parsed.status());
    }

    /**
     * 코치가 마무리를 마쳤는지. 상태 줄의 칸 중 하나(이번 응답이 하는 일)가 마무리2 또는 끝이다.
     * 프롬프트 판마다 그 칸의 자리가 다르다("순간2 · 마무리2 · …", "마무리2 · 응답 6번째").
     */
    static boolean finished(Parsed parsed) {
        for (String part : parsed.status().split("·")) {
            String action = part.strip();
            if (action.startsWith("마무리2") || action.startsWith("끝")) return true;
        }
        return false;
    }

    private static final Pattern DESIGN_HABIT = Pattern.compile("(?m)^\\s*버릇\\s*:\\s*\\[?([^|\\]\\n]+)");
    private static final Pattern DESIGN_NEXT = Pattern.compile("(?m)^\\s*다음 테이크\\s*:\\s*\\[?([^\\]\\n]+)");
    private static final Pattern VAGUE = Pattern.compile("(?:잘\\s*)?(?:모르겠(?:어|어요|다|음)?|몰라(?:요)?|ㅇㅇ|ㅇㅋ|네|넵|응|아 네)[.!?~\\s]*");
    private static final int TITLE_MAX = 40;

    /**
     * 연습 루프 세션의 노트(3층). 코치가 이미 정리해 둔 것으로 채운다 — 영상 직접 코칭은 구조화된
     * 방향·초점을 만들지 않아 기존 노트 생성기는 record_only 로 떨어진다.
     *
     * <p>제목은 이번 버릇, 요약은 배우가 쓴 자기에 대한 한 줄과 버릇이 나온 이유(배우의 말 원문),
     * 다음 촬영은 설계의 다음 테이크 한 가지다. 연습 루프가 아니거나 설계가 없으면 {@code null}.
     */
    static ConversationRepository.NewNote note(CoachSessionSnapshot session, long sourceRevision) {
        JsonNode state = session.coachingState();
        JsonNode loop = state == null ? null : state.path(STATE_KEY);
        if (loop == null || !loop.isObject()) return null;
        String design = loop.path("design").asText("");
        String habit = first(DESIGN_HABIT, design);
        String next = first(DESIGN_NEXT, design);
        if (habit.isBlank() && next.isBlank()) return null;
        var quotes = com.acttub.actingapi.integration.llm.StructuredJson.MAPPER.createArrayNode();
        String selfLine = null;
        String selfRef = null;
        String reason = null;
        String reasonRef = null;
        List<CoachTurnSnapshot> turns = session.turns();
        String lastAction = "";
        int coachIndex = 0;
        for (int i = 0; i < turns.size(); i++) {
            CoachTurnSnapshot turn = turns.get(i);
            if ("ai".equals(turn.role())) {
                String status = loop.path("statuses").path(coachIndex++).asText("");
                lastAction = action(status);
                continue;
            }
            String text = turn.text() == null ? "" : turn.text().strip();
            if (text.isEmpty() || VAGUE.matcher(text).matches()
                    || com.acttub.actingapi.feature.coach.domain.ClosingIntent.isClosing(text)) continue;
            if (lastAction.startsWith("마무리1") && selfLine == null) {
                selfLine = text;
                selfRef = StructuredCoachEngine.turnId(session, i);
            } else if (lastAction.startsWith("파고들기")) {
                // 버릇이 언제·왜 나오는지에 대한 배우의 마지막 답.
                reason = text;
                reasonRef = StructuredCoachEngine.turnId(session, i);
            }
        }
        if (selfLine != null) quotes.addObject().put("quote", selfLine).put("kind", "actor").put("source_ref", selfRef);
        if (reason != null) quotes.addObject().put("quote", reason).put("kind", "actor").put("source_ref", reasonRef);
        String title = habit.isBlank() ? null : shorten(habit, TITLE_MAX);
        String nextTake = next.isBlank() ? null : next;
        var empty = com.acttub.actingapi.integration.llm.StructuredJson.MAPPER.createArrayNode();
        return new ConversationRepository.NewNote("v2", nextTake == null ? "observation" : "action", title, quotes,
                nextTake, empty, empty, empty, false, sourceRevision, null);
    }

    /** 상태 줄에서 이번 응답이 한 일. 첫 턴(상태 없음)은 비추기다. */
    private static String action(String status) {
        if (status.isBlank()) return "비추기";
        for (String part : status.split("·")) {
            String value = part.strip();
            if (!value.startsWith("응답") && !value.startsWith("순간") && !value.startsWith("장면")
                    && !value.startsWith("누적")) return value;
        }
        return "";
    }

    private static String shorten(String text, int max) {
        String value = text.strip().replaceAll("[.。]+$", "");
        if (value.codePointCount(0, value.length()) <= max) return value;
        int cut = value.offsetByCodePoints(0, max);
        int space = value.lastIndexOf(' ', cut);
        return (space > max / 2 ? value.substring(0, space) : value.substring(0, cut)).strip() + "…";
    }

    private static String first(Pattern pattern, String text) {
        Matcher matcher = pattern.matcher(text);
        return matcher.find() ? matcher.group(1).strip() : "";
    }
}
