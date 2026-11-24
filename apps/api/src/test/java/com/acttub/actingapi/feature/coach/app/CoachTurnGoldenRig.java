package com.acttub.actingapi.feature.coach.app;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Deque;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.function.Function;
import java.util.function.UnaryOperator;
import java.util.stream.Stream;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.observation.ReplyTrace;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.platform.observability.LlmCall;
import com.acttub.actingapi.platform.observability.LlmTokens;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.JsonNode;

/**
 * {@link CoachTurnGoldenTest} 의 실행 틀. 가짜 모델로 코치를 실제로 돌리고, 한 차례마다 모델로 나간 요청·관측 기록·실패 보고·로그·
 * 배우에게 간 말·저장 상태·handoff·노트를 글로 적는다.
 *
 * <p>모델 요청은 {@link DirectVideoModel} 에 넘긴 값 그대로다(영상, 대화 기록, 지시문, 분류 목록, 생각을 최소로 쓰게 했는지).
 * HTTP 본문은 이 값으로만 만들어지므로 여기서 같으면 Gemini 로 나가는 본문도 같다.
 *
 * <p>기록을 짧게 하려고 지시문 파일({@code coaching/**}.txt)과 글자 하나까지 같은 덩어리는 {@code ⟪파일⟫} 로 적는다.
 * 파일과 조금이라도 다르게 실렸으면 바꾸지 않고 원문이 그대로 남는다. 시간(시작 시각, 걸린 시간, {@code *_ms}, 로그 인자)만 적지 않는다.
 */
final class CoachTurnGoldenRig {
    static final UUID SESSION = UUID.fromString("00000000-0000-4000-8000-000000000001");
    static final UUID PRACTICE = UUID.fromString("00000000-0000-4000-8000-000000000002");
    static final UUID USER = UUID.fromString("00000000-0000-4000-8000-000000000003");
    static final UUID OPERATION = UUID.fromString("00000000-0000-4000-8000-000000000004");
    static final String MAIN_MODEL = "gemini-3-flash-preview";

    final List<Made> calls = Collections.synchronizedList(new ArrayList<>());
    final List<Scripted> models = new ArrayList<>();
    final Scripted model = model(MAIN_MODEL, "main");
    final CoachVideoSource videos = mock(CoachVideoSource.class);
    final ObjectStorage storage = mock(ObjectStorage.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
    final StringBuilder out = new StringBuilder();
    private final ListAppender<ILoggingEvent> logs = new ListAppender<>();
    private final Logger coachLog = (Logger) LoggerFactory.getLogger(DirectVideoCoach.class);
    CoachVideoSource.Video source = new CoachVideoSource.Video("owned/video.mp4", "video/mp4", "etag");
    DirectVideoCoach coach;
    /** 곁가지 호출이 다른 스레드에서 돌아 호출 순서가 정해지지 않는 차례. 호출 기록을 글 순서로 적는다. */
    boolean unordered;
    private int turnNo;

    CoachTurnGoldenRig() {
        when(videos.find(any(), any())).thenAnswer(call -> source);
        when(storage.downloadToPath(anyString(), any())).thenAnswer(call -> {
            Path path = call.getArgument(1);
            Files.writeString(path, "original video bytes");
            return new StoredObjectMetadata(20, "video/mp4", "\"etag\"");
        });
        coach = TestDirectVideoCoach.of(model, videos, storage, failures, telemetry).build();
        logs.start();
        coachLog.addAppender(logs);
    }

    /** 이 틀이 기록하는 가짜 모델을 하나 더 만든다(비교 모델, 분류 모델). */
    Scripted model(String name, String tag) {
        var scripted = new Scripted(name, tag, calls);
        models.add(scripted);
        return scripted;
    }

    void close() {
        coachLog.detachAppender(logs);
    }

    /** 정해 둔 답이 남았으면 시나리오가 의도한 갈래를 타지 않은 것이다. */
    List<String> leftovers() {
        var left = new ArrayList<String>();
        for (Scripted scripted : models) {
            if (!scripted.replies.isEmpty()) left.add(scripted.tag + " 대화 답 " + scripted.replies.size());
            if (!scripted.lights.isEmpty()) left.add(scripted.tag + " 가벼운 답 " + scripted.lights.size());
            if (!scripted.classifications.isEmpty()) left.add(scripted.tag + " 분류 답 " + scripted.classifications.size());
        }
        return left;
    }

    // ---- 세션 ----

    static CoachSessionSnapshot fresh() {
        return fresh("", 8000, null, null);
    }

    static CoachSessionSnapshot fresh(String situation, int durationMs, String blockageDetail, String purpose) {
        return new CoachSessionSnapshot(SESSION, PRACTICE, USER, StructuredJson.MAPPER.createObjectNode(), situation, "", "",
                durationMs, "그 외", "그 외", blockageDetail, "open", "", List.of(), PriorContext.EMPTY, "three_layers_v1", 0,
                null, null, purpose);
    }

    /** 연습 루프 상태 없이 이미 주고받은 옛 대화(2026-09-24 전). */
    static CoachSessionSnapshot beforeLoop(String... turns) {
        var list = new ArrayList<CoachTurnSnapshot>();
        for (int i = 0; i < turns.length; i++) list.add(new CoachTurnSnapshot(i % 2 == 0 ? "ai" : "actor", turns[i]));
        var state = CoachingStateReducer.empty().put("revision", 3);
        return new CoachSessionSnapshot(SESSION, PRACTICE, USER, StructuredJson.MAPPER.createObjectNode(), "", "", "", 8000,
                "그 외", "그 외", null, "open", "", list, PriorContext.EMPTY, "three_layers_v1", 3, state, null, null);
    }

    /** 저장된 상태를 고친 사본(이어하기 표시, 1층 칸 등). 판은 그대로다. */
    static CoachSessionSnapshot editState(CoachSessionSnapshot session, UnaryOperator<tools.jackson.databind.node.ObjectNode> edit) {
        var state = edit.apply(((tools.jackson.databind.node.ObjectNode) session.coachingState()).deepCopy());
        return session.withCoachingState(session.experienceVersion(), session.stateRevision(), state, session.status(),
                session.closeReason());
    }

    // ---- 차례 ----

    CoachResult turn(CoachSessionSnapshot session, String actorText) {
        return run(session, actorText, false);
    }

    CoachResult streamed(CoachSessionSnapshot session, String actorText) {
        return run(session, actorText, true);
    }

    void section(String title) {
        out.append("\n# ").append(title).append('\n');
    }

    private CoachResult run(CoachSessionSnapshot session, String actorText, boolean stream) {
        turnNo++;
        calls.clear();
        telemetry.clear();
        failures.clear();
        logs.list.clear();
        var deltas = Collections.synchronizedList(new ArrayList<String>());
        CoachStream sink = !stream ? null : new CoachStream() {
            @Override public void begin() { deltas.add("(begin)"); }
            @Override public void delta(String text) { deltas.add(text); }
        };
        CoachResult result = null;
        String failed = null;
        try {
            result = coach.turn(session, actorText, OPERATION, sink);
        } catch (CoachReplyUnavailable unavailable) {
            failed = unavailable.getClass().getSimpleName();
        }
        out.append("\n## 차례 ").append(turnNo).append(stream ? " (스트리밍 요청)" : "").append('\n');
        out.append("배우 말: ").append(actorText == null ? "(없음, 첫 응답)" : actorText).append('\n');
        out.append("\n### 모델 호출\n");
        List<Made> made = new ArrayList<>(calls);
        if (unordered) made.sort(Comparator.comparing(Made::text));
        if (made.isEmpty()) out.append("(없음)\n");
        for (int i = 0; i < made.size(); i++) out.append("[").append(i + 1).append("] ").append(made.get(i).text());
        if (stream) {
            out.append("\n### 흘려보낸 글\n");
            deltas.forEach(delta -> out.append("- ").append(quoted(delta)).append('\n'));
        }
        out.append("\n### 관측 기록\n");
        if (telemetry.calls().isEmpty()) out.append("(없음)\n");
        telemetry.calls().forEach(call -> telemetry(call, made));
        out.append("\n### 실패 보고\n");
        if (failures.reports().isEmpty()) out.append("(없음)\n");
        failures.reports().forEach(report -> out.append("- ").append(report.kind()).append(" · ").append(report.context())
                .append(" · ").append(report.failure().getClass().getSimpleName()).append(": ")
                .append(report.failure().getMessage()).append('\n'));
        out.append("\n### 로그\n");
        logs.list.forEach(event -> out.append("- ").append(event.getLevel()).append(' ').append(event.getMessage()).append('\n'));
        out.append("\n### 결과\n");
        if (failed != null) {
            out.append("실패: ").append(failed).append('\n');
            return null;
        }
        var next = result.session();
        out.append("응답 상태: ").append(result.reply().status()).append('\n');
        out.append("대화 상태: ").append(next.status()).append(" · 닫힌 사유: ").append(next.closeReason())
                .append(" · 판: ").append(next.stateRevision()).append('\n');
        out.append("코치 말:\n").append(block(result.reply().message()));
        out.append("저장 상태:\n").append(block(pretty(sameAsInput(next.coachingState(), session.coachingState()))));
        out.append("handoff:\n").append(block(result.reply().handoff() == null ? "(없음)" : pretty(result.reply().handoff())));
        out.append("화면의 목적 칸: ").append(PurposeView.from(next.sessionPurpose(), next.coachingState())).append('\n');
        out.append("화면의 예시 답: ").append(AnswerExamples.from(next.sessionPurpose(), next.coachingState())).append('\n');
        if ("closed".equals(next.status())) {
            var note = DirectVideoPracticeLoop.note(next, next.stateRevision());
            out.append("연습 루프 노트:\n").append(block(note == null ? "(없음)" : note.toString()));
        }
        return result;
    }

    private void telemetry(LlmCall call, List<Made> made) {
        out.append("- ").append(call.step()).append(" · ").append(call.model()).append(" · 실패 ")
                .append(call.errorMessage() == null ? "없음" : call.errorMessage()).append('\n');
        out.append("  회차·배우: ").append(call.practiceSessionId()).append(" · ").append(call.userId()).append('\n');
        out.append("  토큰: ").append(call.tokens()).append(" · 비용: ").append(call.cost()).append('\n');
        out.append("  프롬프트: ").append(call.prompt() == null ? "(없음)" : call.prompt().name()).append('\n');
        if (call.prompt() != null) out.append(indent(shrink(call.prompt().text()), "    "));
        out.append("  metadata:\n");
        new TreeMap<>(call.metadata()).forEach((key, value) -> out.append("    ").append(key).append('=')
                .append(key.endsWith("_ms") ? "(시간)" : value).append('\n'));
        out.append("  입력:\n").append(indent(shrink(sameAsCall(call.input(), made)), "    "));
        out.append("  출력:\n").append(indent(shrink(sameAsCall(call.output(), made)), "    "));
    }

    /**
     * 관측 기록의 입력·출력은 모델 호출에 넘긴 지시문(기록용 모양)·대화 기록·받은 답을 이어 붙인 것이다. 같은 글은 호출 번호로 적는다.
     * 한 글자라도 다르면 바꾸지 않아 원문이 남는다.
     */
    static String sameAsCall(String text, List<Made> made) {
        if (text == null) return null;
        String result = text;
        for (int i = made.size() - 1; i >= 0; i--) {
            Made call = made.get(i);
            if (call.answer() != null && result.equals(call.answer())) return "⟪호출 " + (i + 1) + " 답⟫";
        }
        for (int i = made.size() - 1; i >= 0; i--) {
            Made call = made.get(i);
            if (call.instruction() != null && call.instruction().length() >= 40) {
                result = result.replace(call.instruction(), "⟪호출 " + (i + 1) + " 지시문⟫");
            }
            if (call.history() != null && call.history().length() >= 40) {
                result = result.replace(call.history(), "⟪호출 " + (i + 1) + " 기록⟫");
            }
        }
        return result;
    }

    /** 모델 호출 하나. {@code instruction} 은 관측 기록에 실리는 모양({@link DirectVideoModel#readable}), {@code history} 는 목록의 글 모양이다. */
    record Made(String text, String instruction, String history, String answer) { }

    /** 저장 상태에서 60자 넘는 글 칸이 이번 차례에 받은 상태의 같은 자리와 같으면 표시만 남긴다. */
    static JsonNode sameAsInput(JsonNode output, JsonNode input) {
        if (output == null) return null;
        JsonNode copy = output.deepCopy();
        mark(copy, input, "");
        return copy;
    }

    private static void mark(JsonNode node, JsonNode input, String pointer) {
        if (node instanceof tools.jackson.databind.node.ObjectNode object) {
            for (String name : List.copyOf(object.propertyNames())) {
                String child = pointer + "/" + name.replace("~", "~0").replace("/", "~1");
                JsonNode value = object.get(name);
                if (same(value, input, child)) object.put(name, "⟪받은 상태와 같음⟫");
                else mark(value, input, child);
            }
        } else if (node instanceof tools.jackson.databind.node.ArrayNode array) {
            for (int i = 0; i < array.size(); i++) {
                String child = pointer + "/" + i;
                if (same(array.get(i), input, child)) array.set(i, tools.jackson.databind.node.StringNode.valueOf("⟪받은 상태와 같음⟫"));
                else mark(array.get(i), input, child);
            }
        }
    }

    private static boolean same(JsonNode value, JsonNode input, String pointer) {
        if (input == null || value == null || !value.isString() || value.asString().length() < 60) return false;
        JsonNode before = input.at(pointer);
        return before != null && before.isString() && before.asString().equals(value.asString());
    }

    // ---- 글 ----

    static String pretty(JsonNode node) {
        if (node == null) return "null";
        return StructuredJson.MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(node);
    }

    static String block(String text) {
        return indent(shrink(text), "  ");
    }

    /** 여러 줄 글을 들여 쓴다. 줄 끝·빈 줄까지 그대로 남기고, 끝이 개행인지는 {@code ⏎} 로 적는다. */
    static String indent(String text, String prefix) {
        if (text == null) return prefix + "(null)\n";
        var lines = text.split("\n", -1);
        var sb = new StringBuilder();
        for (String line : lines) sb.append(prefix).append('|').append(line).append('\n');
        return sb.toString();
    }

    static String quoted(String text) {
        return text == null ? "(null)" : "«" + text.replace("\n", "⏎") + "»";
    }

    /** 지시문 파일 그대로인 덩어리를 파일 이름으로 바꾼다. 긴 것부터 바꾼다. */
    static String shrink(String text) {
        if (text == null) return null;
        String shrunk = text;
        for (var block : BLOCKS) shrunk = shrunk.replace(block.getValue(), "⟪" + block.getKey() + "⟫");
        return shrunk;
    }

    /**
     * 기록을 뜬 뒤 자바 문자열에서 파일로 옮긴 지시문(SOMA-1133). 옮기기 전 기록과 바이트까지 견주려고 파일 이름으로 줄이지 않고
     * 원문으로 적는다.
     */
    static final java.util.Set<String> RAW = java.util.Set.of("direct-video/purpose/direct.txt",
            "direct-video/purpose/talk/direct.txt", "direct-video/purpose/reading/direct.txt",
            "direct-video/purpose/character/wrap-card.txt", "direct-video/purpose/talk/character/wrap-card.txt",
            "direct-video/purpose/answer-after-wrap.txt", "direct-video/purpose/asked.txt");

    /** {@link #RAW} 보다 뒤에 둔다 — 정적 초기화 순서대로 읽는다. */
    static final List<Map.Entry<String, String>> BLOCKS = blocks();

    private static List<Map.Entry<String, String>> blocks() {
        var found = new ArrayList<Map.Entry<String, String>>();
        Path root = Path.of("src/main/resources/coaching");
        try (Stream<Path> files = Files.walk(root)) {
            for (Path file : files.filter(path -> path.toString().endsWith(".txt")).sorted().toList()) {
                String text = Files.readString(file, StandardCharsets.UTF_8).strip();
                String name = root.relativize(file).toString();
                if (text.length() >= 120 && !RAW.contains(name)) found.add(Map.entry(name, text));
            }
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        }
        // 연습 루프 첫 지시는 연습마다 칸 순서를 섞는다. 섞인 글은 파일과 다르므로 글의 지문으로 적는다.
        for (Locale language : List.of(Locale.KOREAN, Locale.ENGLISH, Locale.JAPANESE)) {
            String shuffled = DirectVideoPrompts.practiceLoop(PRACTICE, language);
            found.add(Map.entry("practiceLoop(" + language + ") sha256:" + sha(shuffled), shuffled));
        }
        found.sort(Comparator.comparingInt((Map.Entry<String, String> entry) -> entry.getValue().length()).reversed()
                .thenComparing(Map.Entry::getKey));
        return List.copyOf(found);
    }

    static String sha(String text) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)))
                    .substring(0, 16);
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    // ---- 가짜 모델 ----

    /** 정해 둔 답을 차례로 내는 모델. 정해 둔 답이 모자라면 시험이 틀린 것이라 {@link AssertionError} 로 멈춘다. */
    static final class Scripted implements DirectVideoModel {
        static final Object EMPTY = new Object();
        final String name;
        final String tag;
        final List<Made> calls;
        final Deque<Object> replies = new ArrayDeque<>();
        /** 생각을 거의 하지 않는 호출(다듬기·줄이기·빈 답 세 번째)의 답. */
        final Deque<Object> lights = new ArrayDeque<>();
        final Deque<Object> classifications = new ArrayDeque<>();
        final Deque<Boolean> readiness = new ArrayDeque<>();
        /** 정해 두면 대화 답을 지시문으로 고른다(동시에 도는 곁가지 호출). */
        Function<String, String> byInstruction;
        InputInspection inspection = new InputInspection(true, false, true);
        RuntimeException inspectFailure;
        int uploads;

        Scripted(String name, String tag, List<Made> calls) {
            this.name = name;
            this.tag = tag;
            this.calls = calls;
        }

        Scripted says(Object... answers) {
            for (Object answer : answers) replies.add(answer == null ? EMPTY : answer);
            return this;
        }

        Scripted saysLight(Object... answers) {
            for (Object answer : answers) lights.add(answer == null ? EMPTY : answer);
            return this;
        }

        Scripted classifies(String... outputs) {
            classifications.addAll(List.of(outputs));
            return this;
        }

        @Override public String model() { return name; }

        @Override public InputInspection inspect(Path path) {
            record("inspect", "  파일: " + file(path) + "\n  ← " + (inspectFailure != null ? "예외 " + inspectFailure.getMessage() : inspection) + "\n");
            if (inspectFailure != null) throw inspectFailure;
            return inspection;
        }

        @Override public Video upload(Path path, String mimeType) {
            return uploaded("upload/2", path, mimeType, null, null);
        }

        @Override public Video upload(Path path, String mimeType, InputInspection inspection) {
            return uploaded("upload/3", path, mimeType, inspection, null);
        }

        @Override public Video upload(Path path, String mimeType, InputInspection inspection, String label) {
            return uploaded("upload/4", path, mimeType, inspection, label);
        }

        private Video uploaded(String kind, Path path, String mimeType, InputInspection inspection, String label) {
            int n;
            synchronized (this) { n = ++uploads; }
            Video video = new Video("files/" + tag + "-" + n, "gemini://" + tag + "-" + n, mimeType,
                    inspection == null ? null : inspection.hasAudioTrack());
            record(kind, "  파일: " + file(path) + "\n  형식: " + mimeType + "\n  검사: " + inspection + "\n  이름표: " + label
                    + "\n  ← " + video(video) + "\n");
            return video;
        }

        @Override public boolean ready(Video video) {
            Boolean ready;
            synchronized (this) { ready = readiness.isEmpty() ? Boolean.TRUE : readiness.poll(); }
            record("ready", "  영상: " + video(video) + "\n  ← " + ready + "\n");
            return ready;
        }

        @Override public void delete(Video video) {
            record("delete", "  영상: " + video(video) + "\n");
        }

        @Override public String reply(Video video, List<Message> history, String instruction) {
            return answer("reply", video, history, instruction);
        }

        @Override public String replyLight(Video video, List<Message> history, String instruction) {
            return answer("replyLight", video, history, instruction);
        }

        @Override public String replyStream(Video video, List<Message> history, String instruction,
                java.util.function.Consumer<String> onText) {
            String reply = answer("replyStream", video, history, instruction);
            if (reply == null) return null;
            // 줄마다 한 조각으로 흘린다. 깨진 글이면 VisibleCoachText 가 이 안에서 끊는다.
            int start = 0;
            while (start < reply.length()) {
                int end = reply.indexOf('\n', start);
                end = end < 0 ? reply.length() : end + 1;
                onText.accept(reply.substring(start, end));
                start = end;
            }
            return reply;
        }

        @Override public String classify(List<Message> history, String instruction, List<String> categories) {
            Object next;
            synchronized (this) { next = classifications.poll(); }
            if (next == null) throw new AssertionError("분류 답을 정해 두지 않았다: " + tag + "\n" + madeSoFar());
            spend();
            String answer = next instanceof RuntimeException ? null : (String) next;
            record("classify", "  생각 최소: " + ReplyTrace.minimalRequested() + "\n  기록:\n" + history(history)
                    + "  지시문:\n" + indent(shrink(instruction), "    ") + "  분류 목록: " + categories + "\n  ← "
                    + (answer == null ? "예외 " + ((RuntimeException) next).getMessage() : quoted(answer)) + "\n",
                    instruction, String.valueOf(history), answer);
            if (next instanceof RuntimeException failure) throw failure;
            return answer;
        }

        private String answer(String kind, Video video, List<Message> history, String instruction) {
            Object next;
            if (byInstruction != null && kind.equals("reply")) {
                next = byInstruction.apply(instruction);
            } else {
                synchronized (this) { next = kind.equals("replyLight") ? lights.poll() : replies.poll(); }
            }
            if (next == null) throw new AssertionError("대화 답을 정해 두지 않았다: " + tag + " " + kind + "\n" + madeSoFar()
                    + "지시문 끝:\n" + instruction.substring(Math.max(0, instruction.length() - 1500)));
            spend();
            String answer = next == EMPTY || next instanceof RuntimeException ? null : (String) next;
            record(kind, "  생각 최소: " + ReplyTrace.minimalRequested() + "\n  영상: " + video(video) + "\n  기록:\n"
                    + history(history) + "  지시문:\n" + indent(shrink(instruction), "    ") + "  ← "
                    + (next instanceof RuntimeException failure ? "예외 " + failure.getMessage() : quoted(answer)) + "\n",
                    DirectVideoModel.readable(instruction), String.valueOf(history), answer);
            if (next instanceof RuntimeException failure) throw failure;
            return answer;
        }

        /** 실제 모델처럼 이 턴의 토큰을 더한다. 회차 영상 예산과 비용 칸이 이 값을 읽는다. */
        private void spend() {
            ReplyTrace trace = ReplyTrace.current();
            if (trace != null) trace.add(name, LlmTokens.of(1200, 60, 1260, 400));
        }

        private void record(String kind, String body) {
            record(kind, body, null, null, null);
        }

        private void record(String kind, String body, String instruction, String history, String answer) {
            calls.add(new Made(kind + " · " + tag + "\n" + body, instruction, history, answer));
        }

        private String madeSoFar() {
            var sb = new StringBuilder();
            synchronized (calls) { calls.forEach(call -> sb.append(call.text())); }
            return sb.toString();
        }

        private static String history(List<Message> history) {
            if (history == null) return "    (null)\n";
            var sb = new StringBuilder();
            for (Message message : history) sb.append("    [").append(message.role()).append("]\n").append(indent(shrink(message.text()), "      "));
            return sb.isEmpty() ? "    (비었음)\n" : sb.toString();
        }

        private static String file(Path path) {
            if (path == null) return "(null)";
            try {
                return "임시 파일 «" + Files.readString(path) + "»";
            } catch (IOException | UncheckedIOException failure) {
                return "읽을 수 없는 파일";
            }
        }

        static String video(Video video) {
            return video == null ? "(없음)" : video.name() + " " + video.uri() + " " + video.mimeType() + " 소리 트랙 " + video.hasAudioTrack();
        }
    }
}
