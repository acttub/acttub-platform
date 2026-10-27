package com.acttub.actingapi.feature.coach.app;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import com.acttub.actingapi.feature.coach.app.ConversationRepository.NoteView;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;

/**
 * Pro 의 「대사별로 본 것」(SOMA-900). 대화가 닫히고 노트가 저장된 <b>뒤에</b> 따로 쓴다 — 닫기 응답과 노트 저장을
 * 기다리게 하지 않는다. 배경에서 돌고, 실패는 보고만 하고 삼킨다(노트는 이미 있다).
 *
 * <p>모델에는 닫힌 대화의 턴·연습 루프 설계·확인된 대사만 글로 보낸다. 영상은 올리지 않는다. 항목이 두 칸 이상 비었거나
 * 80자를 넘으면 버리고 최대 {@value #MAX_ITEMS}개만 남긴다. 근거가 모자라면 적게, 없으면 아무것도 붙이지 않는다.
 */
public class LineNoteWriter implements AutoCloseable {

    static final int MAX_ITEMS = 3;
    static final int MAX_FIELD_CHARS = 80;
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String PROMPT_RESOURCE = "/coaching/line-notes-prompt.txt";

    /** 읽은 항목 하나. */
    public record Item(String line, String seen, String tryNext) { }

    private final boolean enabled;
    private final CoachPro pro;
    private final LineNoteModel model;
    private final ConversationRepository conversations;
    private final FailureReporter failures;
    private final Executor executor;
    private final ExecutorService owned;
    private final String template;

    public LineNoteWriter(boolean enabled, CoachPro pro, LineNoteModel model, ConversationRepository conversations,
            FailureReporter failures, Executor executor) {
        this(enabled, pro, model, conversations, failures, executor, null, loadTemplate());
    }

    /** 자기 배경 실행기를 갖는다(스프링 조립용). */
    public static LineNoteWriter withOwnExecutor(boolean enabled, CoachPro pro, LineNoteModel model,
            ConversationRepository conversations, FailureReporter failures) {
        ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor();
        return new LineNoteWriter(enabled, pro, model, conversations, failures, pool, pool, loadTemplate());
    }

    LineNoteWriter(boolean enabled, CoachPro pro, LineNoteModel model, ConversationRepository conversations,
            FailureReporter failures, Executor executor, ExecutorService owned, String template) {
        this.enabled = enabled;
        this.pro = pro == null ? CoachPro.NONE : pro;
        this.model = model;
        this.conversations = conversations;
        this.failures = failures;
        this.executor = executor;
        this.owned = owned;
        this.template = template;
    }

    /**
     * 노트가 저장된 뒤 부른다. 바로 돌아온다 — Pro 판정부터 모델 호출·저장까지 모두 배경에서 한다. 어떤 실패도 던지지
     * 않는다.
     */
    public void schedule(CoachSessionSnapshot session, UUID conversationId, NoteView note) {
        if (!enabled || session == null || conversationId == null || note == null) return;
        if (note.lineNotes() != null && note.lineNotes().isArray() && !note.lineNotes().isEmpty()) return;
        try {
            executor.execute(() -> run(session, conversationId, note));
        } catch (RuntimeException rejected) {
            report(rejected, conversationId);
        }
    }

    void run(CoachSessionSnapshot session, UUID conversationId, NoteView note) {
        try {
            if (!CoachPro.safe(pro, session.userId())) return;
            String prompt = prompt(session, note);
            List<Item> items = parse(model.generate(prompt), note.title(), note.nextTake());
            if (items.isEmpty()) return;
            ArrayNode saved = JSON.createArrayNode();
            for (Item item : items) {
                saved.addObject().put("line", item.line()).put("seen", item.seen()).put("try", item.tryNext());
            }
            conversations.saveLineNotes(conversationId, saved);
        } catch (Exception failure) {
            report(failure, conversationId);
        }
    }

    private void report(Throwable failure, UUID conversationId) {
        try {
            failures.report(failure, new FailureContext("LineNoteWriter.write", conversationId));
        } catch (RuntimeException ignored) {
            // 보고 실패도 코칭을 막지 않는다.
        }
    }

    String prompt(CoachSessionSnapshot session, NoteView note) {
        JsonNode state = session.coachingState();
        String design = state == null ? "" : state.path(DirectVideoPracticeLoop.STATE_KEY).path("design").asText("");
        List<String> lines = state == null ? List.of() : ContinuedTake.linesFromState(state.toString());
        StringBuilder conversation = new StringBuilder();
        for (CoachTurnSnapshot turn : session.turns()) {
            conversation.append("ai".equals(turn.role()) ? "코치: " : "배우: ").append(turn.text()).append('\n');
        }
        return template
                .replace("{{title}}", note.title() == null ? "" : note.title())
                .replace("{{next_take}}", note.nextTake() == null ? "" : note.nextTake())
                .replace("{{design}}", design)
                .replace("{{lines}}", lines.isEmpty() ? "(없음)" : String.join("\n", lines))
                .replace("{{conversation}}", conversation.toString().strip());
    }

    /** 모델 원문을 읽어 쓸 수 있는 항목만 남긴다. 읽지 못하면 빈 목록이다. */
    static List<Item> parse(String raw, String title, String nextTake) {
        List<Item> items = new ArrayList<>();
        if (raw == null || raw.isBlank()) return items;
        JsonNode root;
        try {
            root = JSON.readTree(stripFence(raw));
        } catch (Exception unreadable) {
            return items;
        }
        JsonNode array = root.isArray() ? root : root.path("line_notes");
        if (!array.isArray()) return items;
        for (JsonNode row : array) {
            if (items.size() >= MAX_ITEMS) break;
            if (!row.isObject()) continue;
            String line = text(row.path("line")), seen = text(row.path("seen")), tryNext = text(row.path("try"));
            if (line.isEmpty() || seen.isEmpty() || tryNext.isEmpty()) continue;
            if (line.length() > MAX_FIELD_CHARS || seen.length() > MAX_FIELD_CHARS || tryNext.length() > MAX_FIELD_CHARS) continue;
            if (same(seen, title) || same(tryNext, title) || same(tryNext, nextTake) || same(seen, nextTake)) continue;
            items.add(new Item(line, seen, tryNext));
        }
        return items;
    }

    private static boolean same(String value, String other) {
        return other != null && !other.isBlank() && normalized(value).equals(normalized(other));
    }

    private static String normalized(String value) {
        return value.replaceAll("[\\s\\p{Punct}]", "").toLowerCase(Locale.ROOT);
    }

    private static String text(JsonNode value) {
        return value == null || !value.isTextual() ? "" : value.asText().strip();
    }

    private static String stripFence(String raw) {
        String trimmed = raw.strip();
        if (trimmed.startsWith("```")) {
            int firstBreak = trimmed.indexOf('\n');
            int lastFence = trimmed.lastIndexOf("```");
            if (firstBreak >= 0 && lastFence > firstBreak) return trimmed.substring(firstBreak + 1, lastFence).strip();
        }
        return trimmed;
    }

    private static String loadTemplate() {
        try (InputStream input = LineNoteWriter.class.getResourceAsStream(PROMPT_RESOURCE)) {
            if (input == null) throw new IllegalStateException("missing " + PROMPT_RESOURCE);
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        } catch (java.io.IOException unreadable) {
            throw new IllegalStateException("cannot read " + PROMPT_RESOURCE, unreadable);
        }
    }

    @Override
    public void close() {
        if (owned != null) owned.close();
    }
}
