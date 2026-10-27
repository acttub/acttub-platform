package com.acttub.actingapi.feature.coach.app;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * 배우 일지(practice.journal, SOMA-720)의 값과 자동 칸 규칙.
 *
 * <p>일지는 두 부분이다. <b>배우의 답</b>(고정 질문 4개: 해 보니·아직 모르는 것·다음에 해 볼 것·오늘의 후기)은 받은 그대로
 * 둔다. <b>자동 칸</b>(오늘 한 연습·장면과 인물·받은 피드백)은 코칭 대화로 모델이 만든다
 * ({@code coaching/journal-create.txt}, 10/19 채택 v4). 모델의 답은 v4 검사기({@code validate.cjs})와 같은 규칙으로 항목마다
 * 걸러 근거가 맞지 않는 항목을 버린다 — 근거 없는 칸은 빈 칸이다. 피드백의 {@code moment_ref} 는 영상 관찰의 시간(초)으로 바꿔 둔다.
 */
public final class ActorJournal {

    public static final String SCHEMA_VERSION = "acttub.actor_journal_draft.v4";
    public static final String PROMPT_RESOURCE = "/coaching/journal-create.txt";

    static final int PRACTICE_MAX = 2;
    static final int CHARACTER_MAX = 3;
    static final int FEEDBACK_MAX = 2;
    static final int PRACTICE_TEXT = 80;
    static final int CHARACTER_TEXT = 50;
    static final int PARTNER_TEXT = 15;
    static final int FEEDBACK_TEXT = 60;

    private static final Set<String> ACTOR_KINDS = Set.of("actor_input", "actor_message");
    private static final Set<String> CHARACTER_KINDS = Set.of("actor_input", "actor_message", "scene_context", "script_excerpt",
            "video_utterance");
    private static final Set<String> FEEDBACK_KINDS = Set.of("actor_input", "actor_message", "coach_message");
    private static final Pattern REPORTED = Pattern.compile("했어요\\.?$");
    private static final Pattern COMMAND = Pattern.compile("(하세요|보세요)\\.?$");

    private ActorJournal() {
    }

    // ---- 값 ----

    /** 질문 1. {@code choice} 는 고른 선택지(없으면 null), {@code text} 는 직접 쓴 글(없으면 null). 둘 다 없으면 건너뜀. */
    public record Feeling(String choice, String text) {
    }

    /** 질문 2. {@code none} 은 「없어요」를 골랐다. */
    public record Unknown(boolean none, String text) {
    }

    /** 질문 3. {@code undecided} 는 「아직 안 정했어요」를 골랐다. */
    public record Next(boolean undecided, String text) {
    }

    /** 배우의 답 넷. 건너뛴 질문은 null 이다. */
    public record Answers(Feeling feeling, Unknown unknown, Next next, String review) {

        public static Answers empty() {
            return new Answers(null, null, null, null);
        }

        /** 「다음에 해 볼 것」으로 보일 글. 「아직 안 정했어요」만 골랐거나 건너뛰었으면 null. */
        public String nextAction() {
            if (next == null || next.text() == null || next.text().isBlank()) return null;
            return next.text().strip();
        }
    }

    /** @param basis actor_report·observed·discussed */
    public record PracticeItem(String text, String basis) {
    }

    /** @param aspect wants·partner·situation */
    public record CharacterItem(String aspect, String text) {
    }

    /** @param giver coach·other @param at 영상 시간(초). 없으면 null */
    public record FeedbackItem(String text, String giver, Integer at) {
    }

    public record Draft(List<PracticeItem> practice, List<CharacterItem> character, List<FeedbackItem> feedback) {

        public Draft {
            practice = practice == null ? List.of() : List.copyOf(practice);
            character = character == null ? List.of() : List.copyOf(character);
            feedback = feedback == null ? List.of() : List.copyOf(feedback);
        }

        public static Draft empty() {
            return new Draft(List.of(), List.of(), List.of());
        }
    }

    /**
     * @param draftStatus pending(만드는 중)·ready·failed(만들지 못해 배우 답만)·skipped(대화가 없어 만들지 않음)
     * @param title 장면 제목·{@code purpose} 코칭 목적·{@code roleName} 배역 이름 — 화면 머리 줄. 모르면 null
     */
    public record View(
            UUID id,
            UUID practiceId,
            UUID conversationId,
            Answers answers,
            String draftStatus,
            Draft draft,
            Instant editedAt,
            Instant createdAt,
            Instant updatedAt,
            String title,
            String purpose,
            String roleName) {
    }

    // ---- 모델 입력 ----

    /**
     * 프롬프트가 읽는 입력(session·conversation·source_catalog·answers). 대화의 턴 id 는 코치 {@code c<n>}, 배우 {@code m<n>} 이다.
     * 영상 없는 회차에는 영상 관찰·영상 대사를 싣지 않는다.
     *
     * @param purpose 목적별 코칭의 화면 값(정리 카드·받아 적은 대사). 목적 없는 대화는 null
     */
    public static ObjectNode modelInput(ObjectMapper json, CoachSessionSnapshot session, PurposeView purpose, Answers answers) {
        ObjectNode input = json.createObjectNode();
        String rawPurpose = session.sessionPurpose();
        // 리딩 녹음으로 시작한 회차(SOMA-791)도 영상이 없다. 소리만 들었다는 것을 따로 남긴다.
        boolean readingVoice = "reading".equals(rawPurpose);
        boolean noVideo = rawPurpose != null && rawPurpose.startsWith("talk:") || readingVoice;
        ObjectNode meta = input.putObject("session");
        meta.put("input_mode", readingVoice ? "reading_voice" : noVideo ? "no_video" : "video");
        String purposeId = rawPurpose == null ? null : noVideo && !readingVoice ? rawPurpose.substring("talk:".length()) : rawPurpose;
        if (purposeId == null) meta.putNull("purpose"); else meta.put("purpose", purposeId);
        if (session.closeReason() == null) meta.putNull("end_reason"); else meta.put("end_reason", session.closeReason());

        ArrayNode conversation = input.putArray("conversation");
        ArrayNode catalog = input.putArray("source_catalog");
        int coach = 0;
        int actor = 0;
        for (CoachTurnSnapshot turn : session.turns()) {
            if (turn.text() == null || turn.text().isBlank()) continue;
            boolean isActor = "actor".equals(turn.role());
            String id = isActor ? "m" + actor++ : "c" + coach++;
            conversation.addObject().put("id", id).put("role", isActor ? "actor" : "ai").put("text", turn.text());
            catalog.addObject().put("id", id).put("kind", isActor ? "actor_message" : "coach_message").put("text", turn.text());
        }
        String scene = sceneContext(session);
        if (scene != null) catalog.addObject().put("id", "sc1").put("kind", "scene_context").put("text", scene);
        if (!noVideo && purpose != null) {
            int observed = 1;
            if (purpose.card() != null) {
                for (PurposeView.CardItem item : new PurposeView.CardItem[] {
                    purpose.card().issue(), purpose.card().good(), purpose.card().next()}) {
                    if (item == null || item.text() == null || item.text().isBlank() || item.at() == null) continue;
                    catalog.addObject().put("id", "e" + observed++).put("kind", "video_observation").put("text", item.text())
                            .put("start_ms", item.at() * 1000L);
                }
            }
            int heard = 1;
            for (PurposeView.Line line : purpose.lines()) {
                if (line.text() == null || line.text().isBlank()) continue;
                catalog.addObject().put("id", "u" + heard++).put("kind", "video_utterance").put("text", line.text())
                        .put("start_ms", line.at() * 1000L);
            }
        }
        input.set("answers", answersJson(json, answers));
        return input;
    }

    /** 배우가 시작할 때 적은 상황·인물·목표. 모두 비었으면 null. */
    private static String sceneContext(CoachSessionSnapshot session) {
        List<String> parts = new ArrayList<>();
        if (notBlank(session.situation())) parts.add("상황: " + session.situation().strip());
        if (notBlank(session.characterContext())) parts.add("인물: " + session.characterContext().strip());
        if (notBlank(session.goal())) parts.add("목표: " + session.goal().strip());
        return parts.isEmpty() ? null : String.join(" ", parts);
    }

    /** 대화에 배우나 코치의 말이 하나라도 있는가. 없으면 자동 칸을 만들지 않는다. */
    public static boolean hasConversation(CoachSessionSnapshot session) {
        if (session == null) return false;
        for (CoachTurnSnapshot turn : session.turns()) {
            if (turn.text() != null && !turn.text().isBlank()) return true;
        }
        return false;
    }

    // ---- 모델 출력 걸러내기 ----

    /**
     * 모델의 답을 v4 규칙으로 항목마다 거른다. 객체가 아니거나 schema_version 이 다르면 예외 — 생성 실패로 센다.
     * 근거(source_refs)가 입력에 없거나 종류가 맞지 않는 항목, 길이·말투 규칙을 어긴 항목은 버린다.
     */
    public static Draft sanitize(JsonNode output, JsonNode input) {
        if (output == null || !output.isObject() || !SCHEMA_VERSION.equals(output.path("schema_version").asText())) {
            throw new IllegalArgumentException("journal draft schema_version");
        }
        Map<String, JsonNode> sources = new HashMap<>();
        for (JsonNode source : input.path("source_catalog")) sources.put(source.path("id").asText(), source);
        boolean video = "video".equals(input.path("session").path("input_mode").asText());

        List<PracticeItem> practice = new ArrayList<>();
        for (JsonNode item : output.path("practice")) {
            if (practice.size() >= PRACTICE_MAX) break;
            String text = text(item, PRACTICE_TEXT);
            String basis = item.path("basis").asText("");
            List<String> kinds = kinds(item, sources, null, video);
            if (text == null || kinds == null || !Set.of("actor_report", "observed", "discussed").contains(basis)) continue;
            if ("actor_report".equals(basis) && kinds.stream().noneMatch(ACTOR_KINDS::contains)) continue;
            if ("observed".equals(basis) && !kinds.contains("video_observation")) continue;
            practice.add(new PracticeItem(text, basis));
        }

        List<CharacterItem> character = new ArrayList<>();
        Set<String> aspects = new HashSet<>();
        for (JsonNode item : output.path("character")) {
            if (character.size() >= CHARACTER_MAX) break;
            String aspect = item.path("aspect").asText("");
            String text = text(item, "partner".equals(aspect) ? PARTNER_TEXT : CHARACTER_TEXT);
            if (text == null || !Set.of("wants", "partner", "situation").contains(aspect) || aspects.contains(aspect)) continue;
            if (kinds(item, sources, CHARACTER_KINDS, video) == null) continue;
            aspects.add(aspect);
            character.add(new CharacterItem(aspect, text));
        }

        List<FeedbackItem> feedback = new ArrayList<>();
        for (JsonNode item : output.path("feedback")) {
            if (feedback.size() >= FEEDBACK_MAX) break;
            String text = text(item, FEEDBACK_TEXT);
            String giver = item.path("giver").asText("");
            List<String> kinds = kinds(item, sources, FEEDBACK_KINDS, video);
            if (text == null || kinds == null || REPORTED.matcher(text).find() || COMMAND.matcher(text).find()) continue;
            if ("coach".equals(giver) && !kinds.contains("coach_message")) continue;
            if ("other".equals(giver) && kinds.stream().noneMatch(ACTOR_KINDS::contains)) continue;
            if (!"coach".equals(giver) && !"other".equals(giver)) continue;
            Integer at = null;
            JsonNode moment = item.path("moment_ref");
            if (video && moment.isTextual()) {
                JsonNode source = sources.get(moment.asText());
                if (source != null && "video_observation".equals(source.path("kind").asText()) && source.path("start_ms").isNumber()) {
                    at = (int) (source.path("start_ms").asLong() / 1000);
                }
            }
            feedback.add(new FeedbackItem(text, giver, at));
        }
        return new Draft(practice, character, feedback);
    }

    /** 근거 id 들의 종류. 비었거나 겹치거나 모르는 id·허용되지 않은 종류·영상 없는 회차의 영상 근거가 있으면 null. */
    private static List<String> kinds(JsonNode item, Map<String, JsonNode> sources, Set<String> allowed, boolean video) {
        JsonNode refs = item.path("source_refs");
        if (!refs.isArray() || refs.isEmpty()) return null;
        Set<String> seen = new HashSet<>();
        List<String> kinds = new ArrayList<>();
        for (JsonNode ref : refs) {
            String id = ref.asText();
            JsonNode source = sources.get(id);
            if (!seen.add(id) || source == null) return null;
            String kind = source.path("kind").asText("");
            if (allowed != null && !allowed.contains(kind)) return null;
            if (!video && kind.startsWith("video_")) return null;
            kinds.add(kind);
        }
        return kinds;
    }

    private static String text(JsonNode item, int max) {
        if (!item.isObject() || !item.path("text").isTextual()) return null;
        String text = item.path("text").asText().strip();
        if (text.isEmpty() || text.codePointCount(0, text.length()) > max) return null;
        return text;
    }

    // ---- JSON 저장 모양 ----

    public static ObjectNode answersJson(ObjectMapper json, Answers answers) {
        ObjectNode node = json.createObjectNode();
        Answers value = answers == null ? Answers.empty() : answers;
        if (value.feeling() == null) node.putNull("feeling");
        else node.putObject("feeling").put("choice", value.feeling().choice()).put("text", value.feeling().text());
        if (value.unknown() == null) node.putNull("unknown");
        else node.putObject("unknown").put("none", value.unknown().none()).put("text", value.unknown().text());
        if (value.next() == null) node.putNull("next");
        else node.putObject("next").put("undecided", value.next().undecided()).put("text", value.next().text());
        if (value.review() == null) node.putNull("review"); else node.put("review", value.review());
        return node;
    }

    public static Answers answersOf(JsonNode node) {
        if (node == null || !node.isObject()) return Answers.empty();
        JsonNode feeling = node.path("feeling");
        JsonNode unknown = node.path("unknown");
        JsonNode next = node.path("next");
        return new Answers(
                feeling.isObject() ? new Feeling(nullable(feeling.path("choice")), nullable(feeling.path("text"))) : null,
                unknown.isObject() ? new Unknown(unknown.path("none").asBoolean(false), nullable(unknown.path("text"))) : null,
                next.isObject() ? new Next(next.path("undecided").asBoolean(false), nullable(next.path("text"))) : null,
                nullable(node.path("review")));
    }

    public static ObjectNode draftJson(ObjectMapper json, Draft draft) {
        ObjectNode node = json.createObjectNode();
        node.put("schema_version", SCHEMA_VERSION);
        ArrayNode practice = node.putArray("practice");
        draft.practice().forEach(item -> practice.addObject().put("text", item.text()).put("basis", item.basis()));
        ArrayNode character = node.putArray("character");
        draft.character().forEach(item -> character.addObject().put("aspect", item.aspect()).put("text", item.text()));
        ArrayNode feedback = node.putArray("feedback");
        draft.feedback().forEach(item -> {
            ObjectNode out = feedback.addObject().put("text", item.text()).put("giver", item.giver());
            if (item.at() == null) out.putNull("at"); else out.put("at", item.at());
        });
        return node;
    }

    public static Draft draftOf(JsonNode node) {
        if (node == null || !node.isObject()) return Draft.empty();
        List<PracticeItem> practice = new ArrayList<>();
        node.path("practice").forEach(item -> practice.add(new PracticeItem(item.path("text").asText(""), item.path("basis").asText("discussed"))));
        List<CharacterItem> character = new ArrayList<>();
        node.path("character").forEach(item -> character.add(new CharacterItem(item.path("aspect").asText(""), item.path("text").asText(""))));
        List<FeedbackItem> feedback = new ArrayList<>();
        node.path("feedback").forEach(item -> feedback.add(new FeedbackItem(item.path("text").asText(""), item.path("giver").asText("coach"),
                item.path("at").isNumber() ? item.path("at").asInt() : null)));
        return new Draft(practice, character, feedback);
    }

    private static String nullable(JsonNode value) {
        return value == null || value.isNull() || value.isMissingNode() ? null : value.asText();
    }

    private static boolean notBlank(String value) {
        return value != null && !value.isBlank();
    }
}
