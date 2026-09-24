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

    /**
     * 연습 루프 세션의 노트(3층). 코치가 이미 정리해 둔 것으로 {@code acttub.practice_note.v1} 을 조립한다 —
     * 영상 직접 코칭은 구조화된 방향·초점을 만들지 않아 기존 노트 생성기는 record_only 로 떨어진다.
     *
     * <p>제목과 초점은 이번 버릇, 요약과 방향은 배우가 쓴 자기에 대한 한 줄(원문), 촬영 과제는 설계의
     * 다음 테이크 한 가지다. 모든 근거는 handoff 의 대화 출처를 가리킨다. 연습 루프가 아니거나 설계가 없거나
     * 노트 계약을 통과하지 못하면 {@code null} — 그때는 기존 생성기를 쓴다.
     */
    static ObjectNode practiceNote(CoachSessionSnapshot session, JsonNode handoff) {
        try {
            JsonNode state = session.coachingState();
            JsonNode loop = state == null ? null : state.path(STATE_KEY);
            if (loop == null || !loop.isObject() || handoff == null) return null;
            String design = loop.path("design").asText("");
            String habit = first(DESIGN_HABIT, design);
            String next = first(DESIGN_NEXT, design);
            if (habit.isBlank()) return null;
            List<CoachTurnSnapshot> turns = session.turns();
            String selfLine = null;
            String selfRef = null;
            String firstCoachRef = null;
            String lastCoachRef = null;
            String lastAction = "";
            int coachIndex = 0;
            for (int i = 0; i < turns.size(); i++) {
                CoachTurnSnapshot turn = turns.get(i);
                String id = StructuredCoachEngine.turnId(session, i);
                if ("ai".equals(turn.role())) {
                    if (firstCoachRef == null) firstCoachRef = id;
                    lastCoachRef = id;
                    lastAction = action(loop.path("statuses").path(coachIndex++).asText(""));
                    continue;
                }
                String text = turn.text() == null ? "" : turn.text().strip();
                if (text.isEmpty() || VAGUE.matcher(text).matches()
                        || com.acttub.actingapi.feature.coach.domain.ClosingIntent.isClosing(text)) continue;
                if (lastAction.startsWith("마무리1") && selfLine == null) {
                    selfLine = text;
                    selfRef = id;
                }
            }
            if (firstCoachRef == null) return null;
            var mapper = com.acttub.actingapi.integration.llm.StructuredJson.MAPPER;
            boolean action = selfLine != null && !next.isBlank();
            ObjectNode note = mapper.createObjectNode().put("schema_version", "acttub.practice_note.v1")
                    .put("report_type", "practice_note").put("note_id", java.util.UUID.randomUUID().toString())
                    .put("revision", 1).put("session_id", handoff.path("session_id").asText())
                    .put("source_handoff_revision", handoff.path("state_revision").asLong())
                    .put("lifecycle", "saved").put("end_reason", handoff.path("end_reason").asText());
            note.set("record_ref", handoff.path("record_ref").deepCopy());
            note.put("mode", action ? "action" : "observation");
            note.set("scene_context", handoff.path("context").path("scene_context").deepCopy());
            if (action) {
                ObjectNode direction = note.putObject("direction").put("text", limit(selfLine, 100)).put("origin", "actor_stated");
                direction.putArray("source_refs").add(selfRef);
            } else {
                note.putNull("direction");
            }
            ObjectNode focus = note.putObject("focus").put("label", limit(habit, 80)).putNull("utterance_ref");
            focus.putArray("evidence_refs").add(firstCoachRef);
            focus.put("scope", "whole_video").put("pattern", "recurring").put("basis", "delivery");
            note.putNull("reading");
            if (action) {
                ObjectNode practice = note.putObject("practice").put("proposal_id", "practice-loop-" + session.sessionId())
                        .put("selection", "proposed");
                practice.putArray("selection_refs");
                ObjectNode instruction = practice.putObject("instruction").put("text", limit(next, 160));
                instruction.putArray("source_refs").add(lastCoachRef);
                ObjectNode comparison = practice.putObject("comparison").put("text", limit("평소처럼 했을 때: " + habit, 160));
                comparison.putArray("source_refs").add(firstCoachRef);
                practice.putNull("keep");
            } else {
                note.putNull("practice");
            }
            note.putArray("attempts");
            note.set("open_points", handoff.path("context").path("open_points").isArray()
                    ? handoff.path("context").path("open_points").deepCopy() : mapper.createArrayNode());
            ObjectNode copy = note.putObject("copy").put("title", limit(habit, 32));
            if (selfLine != null) {
                ObjectNode summary = copy.putObject("summary").put("text", limit(selfLine, 120));
                summary.putArray("source_refs").add(selfRef);
            } else {
                copy.putNull("summary");
            }
            note.set("source_catalog", handoff.path("source_catalog").deepCopy());
            com.acttub.actingapi.integration.llm.StructuredJson.validate("practice_note", note);
            return note;
        } catch (RuntimeException invalid) {
            return null;
        }
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

    private static String limit(String text, int max) {
        String value = text.strip().replaceAll("[.。]+$", "");
        if (value.codePointCount(0, value.length()) <= max) return value;
        int cut = value.offsetByCodePoints(0, max - 1);
        int space = value.lastIndexOf(' ', cut);
        return (space > max / 2 ? value.substring(0, space) : value.substring(0, cut)).strip() + "…";
    }

    private static String first(Pattern pattern, String text) {
        Matcher matcher = pattern.matcher(text);
        return matcher.find() ? matcher.group(1).strip() : "";
    }
}
