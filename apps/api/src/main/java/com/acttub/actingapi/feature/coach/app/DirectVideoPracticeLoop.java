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
        return new Parsed(design, status, STRAY_TAG.matcher(message).replaceAll("").strip());
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

    /** 코치가 마무리를 마쳤는지. 상태 줄의 둘째 칸(이번 응답이 하는 일)이 마무리2 또는 끝이다. */
    static boolean finished(Parsed parsed) {
        String[] parts = parsed.status().split("·");
        String action = (parts.length > 1 ? parts[1] : parsed.status()).strip();
        return action.startsWith("마무리2") || action.startsWith("끝");
    }

    private static String first(Pattern pattern, String text) {
        Matcher matcher = pattern.matcher(text);
        return matcher.find() ? matcher.group(1).strip() : "";
    }
}
