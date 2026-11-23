package com.acttub.actingapi.feature.coach.app;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import com.acttub.actingapi.feature.coach.domain.ClosingIntent;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * 발표 시연용 정해진 코칭(2026-11 데모). 설정한 이메일의 배우가 영상 코칭(3층)을 하면 모델을 부르지 않고 대본의 코치 말을
 * 순서대로 낸다. 배우가 무슨 답을 하든 다음 말은 대본의 다음 줄이고, 마지막 줄에서 연습 루프가 정리를 마칠 때와 같은 모양
 * ({@code interrupted} → 닫힘 사유 {@code exhausted})으로 닫힌다. 노트도 대본의 것을 쓴다.
 *
 * <p>몇 번째 줄인지는 저장된 코치 턴 수로 정한다 — 서버를 다시 띄워도, 여러 대가 받아도 이어진다.
 */
public final class ScriptedCoach {

    public static final ScriptedCoach NONE = new ScriptedCoach(false, Set.of(), CoachScriptedUsers.NONE,
            Duration.ZERO, Duration.ZERO, List.of(), null, null);

    /** 마지막 줄의 종료 사유. 연습 루프가 마무리를 마쳤을 때와 같다(DirectVideoCoach). */
    static final String END_REASON = "interrupted";

    record Line(String message, List<String> examples) { }

    private final boolean enabled;
    private final Set<String> emails;
    private final CoachScriptedUsers users;
    private final Duration firstDelay;
    private final Duration nextDelay;
    private final List<Line> lines;
    private final String noteTitle;
    private final String noteNextTake;

    ScriptedCoach(boolean enabled, Set<String> emails, CoachScriptedUsers users, Duration firstDelay, Duration nextDelay,
            List<Line> lines, String noteTitle, String noteNextTake) {
        this.enabled = enabled;
        this.emails = Set.copyOf(emails);
        this.users = users == null ? CoachScriptedUsers.NONE : users;
        this.firstDelay = firstDelay;
        this.nextDelay = nextDelay;
        this.lines = List.copyOf(lines);
        this.noteTitle = noteTitle;
        this.noteNextTake = noteNextTake;
    }

    /**
     * @param emails   쉼표로 가른 이메일 목록
     * @param resource 대본 리소스 경로({@code lines[].message·examples}, {@code note.title·next_take})
     */
    public static ScriptedCoach load(boolean enabled, String emails, CoachScriptedUsers users,
            Duration firstDelay, Duration nextDelay, String resource) {
        JsonNode script = StructuredJson.resource(resource);
        List<Line> lines = new ArrayList<>();
        for (JsonNode line : script.path("lines")) {
            List<String> examples = new ArrayList<>();
            line.path("examples").forEach(example -> examples.add(example.asText()));
            lines.add(new Line(line.path("message").asText(), examples));
        }
        if (lines.isEmpty() || lines.stream().anyMatch(line -> line.message().isBlank())) {
            throw new IllegalStateException("scripted coaching needs non-empty lines: " + resource);
        }
        Set<String> parsed = emails == null ? Set.of() : Arrays.stream(emails.split(","))
                .map(email -> email.strip().toLowerCase(Locale.ROOT)).filter(email -> !email.isEmpty())
                .collect(Collectors.toUnmodifiableSet());
        return new ScriptedCoach(enabled, parsed, users, firstDelay, nextDelay, lines,
                script.path("note").path("title").asText(null), script.path("note").path("next_take").asText(null));
    }

    /** 이 대화를 대본으로 할지. 3층(영상 코칭) 대화만이고, 대상 조회가 실패하면 평소대로 간다. */
    boolean appliesTo(CoachSessionSnapshot session) {
        if (!enabled || emails.isEmpty() || session == null || !session.threeLayers()) return false;
        return appliesTo(session.userId());
    }

    /** 이 계정이 대상인지. 대상 조회가 실패하면 평소대로 간다. */
    public boolean appliesTo(UUID userId) {
        if (!enabled || emails.isEmpty() || userId == null) return false;
        try {
            return users.contains(userId, emails);
        } catch (RuntimeException lookupFailed) {
            return false;
        }
    }

    /** 다음 코치 말. 엔진의 결과와 같은 모양(턴 추가·상태 revision+1·마지막이면 handoff)이다. */
    CoachResult turn(CoachSessionSnapshot session, String actorText, CoachStream stream) {
        int index = Math.min(coachReplies(session), lines.size() - 1);
        boolean last = index == lines.size() - 1;
        pause(session.turns().isEmpty() ? firstDelay : nextDelay);
        Line line = lines.get(index);
        ObjectNode state = session.coachingState() instanceof ObjectNode object
                ? object.deepCopy() : CoachingStateReducer.empty();
        state.put("revision", session.stateRevision() + 1);
        ObjectNode loop = state.path(DirectVideoPracticeLoop.STATE_KEY) instanceof ObjectNode existing
                ? existing : state.putObject(DirectVideoPracticeLoop.STATE_KEY);
        ArrayNode statuses = loop.path("statuses") instanceof ArrayNode existing ? existing : loop.putArray("statuses");
        statuses.add(status(index));
        AnswerExamples.remember(state, line.examples());
        if (stream != null) stream.delta(line.message());
        return StructuredCoachEngine.result(session, actorText, line.message(), state, last ? END_REASON : null);
    }

    /**
     * 숨은 상태 칸. 마지막 바로 앞 줄은 "다음에 닫기: 예" 라 화면이 평소처럼 "다음 답으로 마무리해요"를 띄운다
     * ({@link ConversationService#displayLimit}).
     */
    private String status(int index) {
        if (index == lines.size() - 1) {
            return "할 일: 마무리2" + (noteNextTake == null ? "" : "\n다음 테이크: " + noteNextTake);
        }
        return index == lines.size() - 2 ? "할 일: 파고들기\n다음에 닫기: 예" : "할 일: 파고들기";
    }

    /**
     * 대본의 노트. 요약 인용은 이번 대화에서 배우가 실제로 한 첫 답과 마지막 답이다 — 배우가 하지 않은 말을 인용으로 남기지 않는다.
     */
    ConversationRepository.NewNote note(CoachSessionSnapshot session, long sourceRevision) {
        var mapper = StructuredJson.MAPPER;
        ArrayNode quotes = mapper.createArrayNode();
        List<Integer> answers = new ArrayList<>();
        List<CoachTurnSnapshot> turns = session.turns();
        for (int i = 0; i < turns.size(); i++) {
            String text = turns.get(i).text();
            if ("actor".equals(turns.get(i).role()) && text != null && !text.isBlank() && !ClosingIntent.isClosing(text)) {
                answers.add(i);
            }
        }
        if (!answers.isEmpty()) addQuote(quotes, session, answers.getFirst());
        if (answers.size() > 1) addQuote(quotes, session, answers.getLast());
        return new ConversationRepository.NewNote("v2", noteNextTake == null ? "observation" : "action", noteTitle, quotes,
                noteNextTake, mapper.createArrayNode(), mapper.createArrayNode(), mapper.createArrayNode(), false,
                sourceRevision, null);
    }

    private static void addQuote(ArrayNode quotes, CoachSessionSnapshot session, int index) {
        quotes.addObject().put("quote", session.turns().get(index).text().strip()).put("kind", "actor")
                .put("source_ref", StructuredCoachEngine.turnId(session, index));
    }

    private static int coachReplies(CoachSessionSnapshot session) {
        return (int) session.turns().stream().filter(turn -> "ai".equals(turn.role())).count();
    }

    private static void pause(Duration delay) {
        if (delay == null || delay.isZero() || delay.isNegative()) return;
        try {
            Thread.sleep(delay.toMillis());
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }
}
