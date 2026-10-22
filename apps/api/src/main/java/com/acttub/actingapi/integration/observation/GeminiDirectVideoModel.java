package com.acttub.actingapi.integration.observation;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import java.util.function.Predicate;
import java.util.function.Supplier;

import com.acttub.actingapi.integration.media.VideoRecordChunks;
import com.acttub.actingapi.integration.media.VideoFrameEvidence;
import com.acttub.actingapi.integration.media.AudioSignalEvidence;
import com.google.genai.Client;
import com.google.genai.types.Content;
import com.google.genai.types.GenerateContentConfig;
import com.google.genai.types.Part;
import com.google.genai.types.UploadFileConfig;
import com.google.genai.types.GetFileConfig;
import com.google.genai.types.DeleteFileConfig;
import com.google.genai.types.GenerateContentResponse;
import com.google.genai.types.ListFilesConfig;
import com.google.genai.types.HttpOptions;
import com.google.genai.types.ThinkingConfig;

public final class GeminiDirectVideoModel implements DirectVideoModel {
    /**
     * 코치 답의 출력 한도. 생각(thinking) 토큰도 이 한도를 함께 쓴다(SOMA-657).
     * 정상 답은 생각까지 합쳐 많아야 약 1,600토큰이었다(10/11 운영 입력 재현). 8,192이던 때는 생각이 한도까지 차는
     * 폭주가 30~55초 동안 이어진 뒤 빈 답이나 엉뚱한 글이 나왔다. 2,048이면 폭주를 10~20초 안에 끊고 다시 쓴다.
     */
    // 생각 토큰도 이 한도 안에서 쓴다. 2048이면 생각(LOW)이 2,000토큰 가까이 간 답이 글 없이 끊겨 빈 답이 됐다
    // (2026-10-21 로컬 재생: 정리 뒤 "나한테 상대역이 없는데?"에서 thoughts 1963 + 글 81 → MAX_TOKENS). 보이는 답은 짧아서 쓴 만큼만 든다.
    static final int REPLY_TOKEN_LIMIT = 4096;
    private final Client client;
    private final String model;
    private final Predicate<Path> audioProbe;
    private final Predicate<Path> blackFrameProbe;
    private final Predicate<Path> audioSignalProbe;
    private final Hedge hedge;

    /**
     * 느린 요청 다시 보내기(SOMA-780). 답이 이 시간 안에 오지 않으면 같은 요청을 한 번 더 보내고 먼저 온 답을 쓴다.
     * Gemini 는 가끔 50~90초 멈춘다(10/20 운영: 첫 질문 92초 뒤 실패, 답 119초 뒤 실패, 시험 호출 54초). 보통 답은
     * 분류 1~3초, 답 쓰기 4~10초라 그보다 넉넉히 둔다. 스트리밍은 첫 조각이 이 시간 안에 오지 않을 때만 다시 보낸다.
     * 0 이면 끈다(롤백). 다시 보낸 요청만큼 비용이 더 든다 — 느린 요청에만 생긴다.
     */
    public record Hedge(java.time.Duration classify, java.time.Duration reply, java.time.Duration stream) {
        public static final Hedge NONE = new Hedge(java.time.Duration.ZERO, java.time.Duration.ZERO, java.time.Duration.ZERO);
    }

    /** 다시 보낸 요청을 기다리는 곳. 요청 스레드를 막지 않게 가상 스레드를 쓴다. */
    private static final ExecutorService HEDGE_CALLS = Executors.newVirtualThreadPerTaskExecutor();

    public GeminiDirectVideoModel(Client client, String model) {
        this(client, model, new VideoRecordChunks()::hasAudio, new VideoFrameEvidence()::entirelyBlack,
                new AudioSignalEvidence()::hasSignal);
    }

    /** Test-only: existing upload tests do not inspect video frames. */
    GeminiDirectVideoModel(Client client, String model, Predicate<Path> audioProbe) {
        this(client, model, audioProbe, new VideoFrameEvidence()::entirelyBlack, path -> true);
    }

    /** Test-only: both track/frame probes are injected; audio signal is assumed valid. */
    GeminiDirectVideoModel(Client client, String model, Predicate<Path> audioProbe, Predicate<Path> blackFrameProbe) {
        this(client, model, audioProbe, blackFrameProbe, path -> true);
    }

    GeminiDirectVideoModel(Client client, String model, Predicate<Path> audioProbe,
            Predicate<Path> blackFrameProbe, Predicate<Path> audioSignalProbe) {
        this(client, model, audioProbe, blackFrameProbe, audioSignalProbe, Hedge.NONE);
    }

    private GeminiDirectVideoModel(Client client, String model, Predicate<Path> audioProbe,
            Predicate<Path> blackFrameProbe, Predicate<Path> audioSignalProbe, Hedge hedge) {
        this.client = client;
        this.model = model;
        this.audioProbe = audioProbe;
        this.blackFrameProbe = blackFrameProbe;
        this.audioSignalProbe = audioSignalProbe;
        this.hedge = hedge == null ? Hedge.NONE : hedge;
    }

    /** 같은 모델에 느린 요청 다시 보내기를 켠 사본(SOMA-780). */
    public GeminiDirectVideoModel withHedge(Hedge hedge) {
        return new GeminiDirectVideoModel(client, model, audioProbe, blackFrameProbe, audioSignalProbe, hedge);
    }

    @Override
    public InputInspection inspect(Path path) {
        boolean audio = audioProbe.test(path);
        // A track is not proof of sound. Full decode failure blocks upload, never becomes silence.
        // Real audio signal preserves audio-only acting regardless of black frames.
        return audio ? new InputInspection(true, null, audioSignalProbe.test(path))
                : new InputInspection(false, blackFrameProbe.test(path), null);
    }

    @Override
    public Video upload(Path path, String mimeType, InputInspection inspection) {
        return upload(path, mimeType, inspection, null);
    }

    @Override
    public Video upload(Path path, String mimeType) {
        return upload(path, mimeType, null, null);
    }

    /**
     * 이름표를 달아 올린다(SOMA-780). 이름표 끝에 소리 트랙 유무(a1·a0)를 붙여, 다른 서버가 이름표로 찾았을 때도
     * 같은 소리 사실로 프롬프트를 만들게 한다. 이름표가 없으면 예전과 같다.
     */
    @Override
    public Video upload(Path path, String mimeType, InputInspection inspection, String label) {
        if (inspection == null || inspection.hasAudioTrack() == null) {
            // Existing/rollback callers must not bypass silence or decode-failure protection.
            boolean audio = audioProbe.test(path);
            if (audio) requireAudioSignal(path);
            return uploadInspected(path, mimeType, audio, label);
        }
        if (inspection.emptyInput()) throw new IllegalArgumentException("empty input must not be uploaded");
        if (inspection.unusableAudio()) throw new IllegalArgumentException("silent audio must not be uploaded");
        if (Boolean.TRUE.equals(inspection.hasAudioTrack()) && inspection.hasAudioSignal() == null) {
            requireAudioSignal(path);
        }
        return uploadInspected(path, mimeType, inspection.hasAudioTrack(), label);
    }

    private void requireAudioSignal(Path path) {
        if (!audioSignalProbe.test(path)) throw new IllegalArgumentException("silent audio must not be uploaded");
    }

    private Video uploadInspected(Path path, String mimeType, boolean hasAudioTrack, String label) {
        try (var input = Files.newInputStream(path)) {
            var config = UploadFileConfig.builder().mimeType(mimeType)
                    .httpOptions(HttpOptions.builder().timeout(120000).build());
            if (label != null && !label.isBlank()) config.displayName(label + (hasAudioTrack ? AUDIO : SILENT));
            var file = client.files.upload(input, Files.size(path), config.build());
            return new Video(file.name().orElseThrow(), file.uri().orElseThrow(), mimeType, hasAudioTrack);
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        }
    }

    private static final String AUDIO = ":a1";
    private static final String SILENT = ":a0";

    /** 이 접두어로 시작하는 이름표를 단 파일들(SOMA-780). 처리에 실패한 파일은 빼고, 이름표에서 소리 표시는 떼어 돌려준다. */
    @Override
    public List<Labeled> labeled(String prefix) {
        List<Labeled> found = new ArrayList<>();
        if (prefix == null || prefix.isBlank()) return found;
        var config = ListFilesConfig.builder().pageSize(100).httpOptions(HttpOptions.builder().timeout(15000).build()).build();
        for (com.google.genai.types.File file : client.files.list(config)) {
            String label = file.displayName().orElse("");
            if (!label.startsWith(prefix) || file.name().isEmpty() || file.uri().isEmpty()) continue;
            if ("FAILED".equals(file.state().map(Object::toString).orElse(""))) continue;
            Boolean audio = label.endsWith(AUDIO) ? Boolean.TRUE : label.endsWith(SILENT) ? Boolean.FALSE : null;
            String base = audio == null ? label : label.substring(0, label.length() - AUDIO.length());
            found.add(new Labeled(new Video(file.name().get(), file.uri().get(), file.mimeType().orElse("video/mp4"), audio),
                    base, file.createTime().orElse(null)));
        }
        return found;
    }

    @Override
    public boolean ready(Video video) {
        String state = client.files.get(video.name(), GetFileConfig.builder()
                .httpOptions(HttpOptions.builder().timeout(15000).build()).build())
                .state().map(Object::toString).orElse("");
        if ("FAILED".equals(state)) throw new IllegalStateException("video processing failed");
        return "ACTIVE".equals(state);
    }

    @Override
    public String reply(Video video, List<Message> history, String instruction) {
        return generate(video, history, instruction, null, false);
    }

    /** 생각을 거의 하지 않고 쓴다(SOMA-780). 생각 단계만 다르고 나머지는 {@link #reply} 와 같다. */
    @Override
    public String replyLight(Video video, List<Message> history, String instruction) {
        return generate(video, history, instruction, null, true);
    }

    /**
     * 코치 답을 모델이 쓰는 대로 조각씩 넘긴다(코칭 스트리밍). 설정·끊김 처리는 {@link #reply} 와 같다.
     * 조각은 원문 그대로다 — 숨은 메모를 거르는 것은 부르는 쪽이다.
     */
    @Override
    public String replyStream(Video video, List<Message> history, String instruction,
            java.util.function.Consumer<String> onText) {
        Request request = request(video, history, instruction, null, false);
        java.time.Duration after = hedge.stream();
        if (after == null || after.isZero() || after.isNegative()) return streamOnce(request, onText, null);
        // 첫 조각이 정한 시간 안에 오지 않으면 같은 요청을 하나 더 열고, 먼저 조각을 낸 쪽만 배우에게 흘린다.
        var race = new StreamRace(onText);
        CompletableFuture<String> first = CompletableFuture.supplyAsync(
                () -> streamOnce(request, race.sink(1), stream -> race.opened(1, stream)), HEDGE_CALLS);
        CompletableFuture<String> second = race.awaitFirstPiece(after) || first.isDone() ? null
                : CompletableFuture.supplyAsync(() -> streamOnce(request, race.sink(2), stream -> race.opened(2, stream)), HEDGE_CALLS);
        return race.finish(first, second);
    }

    /** 스트림 하나를 끝까지 읽는다. {@code onOpen} 이 있으면 열린 스트림을 넘겨, 진 쪽을 닫을 수 있게 한다. */
    private String streamOnce(Request request, Consumer<String> onText, Consumer<AutoCloseable> onOpen) {
        StringBuilder text = new StringBuilder();
        boolean limited = false;
        try (var stream = client.models.generateContentStream(model, request.contents(), request.config())) {
            if (onOpen != null) onOpen.accept(stream);
            for (var chunk : stream) {
                String piece = chunk.text();
                if (piece != null && !piece.isEmpty()) {
                    text.append(piece);
                    onText.accept(piece);
                }
                if (outputLimitReached(chunk)) limited = true;
                if (request.trace() != null) request.trace().usage(chunk);
            }
        }
        if (limited) throw new IllegalStateException("empty video coaching reply: output limit reached");
        if (text.toString().isBlank()) throw new IllegalStateException("empty video coaching reply");
        return text.toString().strip();
    }

    /** 다시 보낸 스트림 둘 중 먼저 조각을 낸 쪽만 배우에게 흘린다. 진 쪽은 닫고, 남은 조각은 버린다. */
    private static final class StreamRace {
        private final Consumer<String> onText;
        private final AtomicInteger winner = new AtomicInteger();
        private final java.util.concurrent.CountDownLatch firstPiece = new java.util.concurrent.CountDownLatch(1);
        private final java.util.Map<Integer, AutoCloseable> open = new java.util.concurrent.ConcurrentHashMap<>();
        /** 이긴 쪽 번호. 아무도 조각을 내지 못하고 다 끝나면 0. */
        private final CompletableFuture<Integer> decided = new CompletableFuture<>();

        StreamRace(Consumer<String> onText) {
            this.onText = onText;
        }

        Consumer<String> sink(int id) {
            return piece -> {
                if (winner.compareAndSet(0, id)) {
                    firstPiece.countDown();
                    decided.complete(id);
                    open.forEach((other, stream) -> { if (other != id) closeQuietly(open.remove(other)); });
                }
                if (winner.get() != id) throw new IllegalStateException("hedged stream lost the race");
                onText.accept(piece);
            };
        }

        void opened(int id, AutoCloseable stream) {
            open.put(id, stream);
            int won = winner.get();
            if (won != 0 && won != id) closeQuietly(open.remove(id));
        }

        boolean awaitFirstPiece(java.time.Duration after) {
            try {
                return firstPiece.await(after.toMillis(), TimeUnit.MILLISECONDS);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return true;
            }
        }

        /** 이긴 쪽의 답을 돌려준다. 아무도 조각을 내지 못했으면 성공한 쪽의 답, 둘 다 실패했으면 처음 요청의 오류다. */
        String finish(CompletableFuture<String> first, CompletableFuture<String> second) {
            Runnable done = () -> {
                if (first.isDone() && (second == null || second.isDone())) decided.complete(winner.get());
            };
            first.whenComplete((value, error) -> done.run());
            if (second != null) second.whenComplete((value, error) -> done.run());
            int won = decided.join();
            CompletableFuture<String> chosen = won == 2 || won == 0 && first.isCompletedExceptionally()
                    && second != null && !second.isCompletedExceptionally() ? second : first;
            try {
                return chosen.join();
            } catch (CompletionException failed) {
                throw unwrap(failed);
            }
        }
    }

    private static void closeQuietly(AutoCloseable stream) {
        try {
            if (stream != null) stream.close();
        } catch (Exception ignored) {
            // 진 쪽 스트림을 닫다 생긴 오류는 이긴 쪽 답과 상관없다.
        }
    }

    @Override
    public String classify(List<Message> history, String instruction, List<String> categories) {
        // 분류는 LOW 그대로다 — MINIMAL 은 속도 이득이 없고(10/21 dev 30건 중간 1.09→1.105초, 생각 토큰 원래 0) 5건의 분류가 달라졌다.
        return generate(null, history, instruction, categories, false);
    }

    private record Request(List<Content> contents, GenerateContentConfig config, ReplyTrace trace) { }

    private Request request(Video video, List<Message> history, String instruction, List<String> categories, boolean light) {
        boolean classification = categories != null;
        // 코치 답(분류 아님)만 턴 단위 생각 단계 요청을 따른다. 분류는 늘 LOW 다.
        ReplyTrace trace = classification ? null : ReplyTrace.current();
        List<Content> contents = new ArrayList<>();
        if (video != null) contents.add(Content.builder().role("user").parts(
                Part.fromUri(video.uri(), video.mimeType())).build());
        if (classification) {
            // The first coaching turn has model role. Send the transcript as data in a user message,
            // rather than asking the classifier to continue that assistant-led conversation.
            var transcript = com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.arrayNode();
            history.forEach(message -> transcript.addObject().put("role", message.role()).put("text", message.text()));
            contents.add(Content.builder().role("user").parts(Part.fromText(transcript.toString())).build());
        } else {
            for (Message message : history) {
                contents.add(Content.builder().role(message.role())
                        .parts(Part.fromText(message.text())).build());
            }
        }
        var config = GenerateContentConfig.builder()
                        .systemInstruction(Content.fromParts(Part.fromText(instruction)))
                        .httpOptions(HttpOptions.builder().timeout(classification ? 15000 : 90000).build())
                        .thinkingConfig(thinking(light, trace))
                        .maxOutputTokens(classification ? 1024 : REPLY_TOKEN_LIMIT);
        if (classification) {
            config.temperature(0f).responseMimeType("application/json").responseJsonSchema(java.util.Map.of(
                    "type", "object", "properties", java.util.Map.of("signals", java.util.Map.of(
                            "type", "array", "items", java.util.Map.of("type", "string", "enum", categories))),
                    "required", List.of("signals"), "additionalProperties", false));
        }
        return new Request(contents, config.build(), trace);
    }

    /**
     * 생각 단계. gemini-3 계열은 LOW 이고, 가벼운 호출(줄이기)은 MINIMAL 을 받는 모델이면 MINIMAL 이다(SOMA-780).
     * 10/21 서버 실측: 줄이기 LOW 6.0초(생각 1,051토큰) → MINIMAL 1.3초, 줄인 길이는 같았다. 3.8 Flash 는 MINIMAL 을
     * 받지 않아 LOW 로 둔다.
     */
    ThinkingConfig thinking(boolean light) {
        return thinking(light, null);
    }

    /**
     * {@code trace} 가 최소 생각을 요청한 턴(연습 루프 답장, SOMA-780)도 {@code light} 와 같이 MINIMAL 을 받는 모델이면 MINIMAL 이다.
     * 받지 않는 모델은 LOW 그대로다. 적용한 단계는 {@code trace} 에 남긴다.
     */
    ThinkingConfig thinking(boolean light, ReplyTrace trace) {
        if (!model.startsWith("gemini-3")) {
            if (trace != null) trace.applied("off");
            return ThinkingConfig.builder().thinkingBudget(0).build();
        }
        boolean minimal = (light || trace != null && trace.minimal()) && minimalThinking(model);
        if (trace != null) trace.applied(minimal ? "minimal" : "low");
        return ThinkingConfig.builder().thinkingLevel(minimal ? "MINIMAL" : "LOW").build();
    }

    /** MINIMAL 생각 단계를 받는 모델. 확인한 것은 gemini-3-flash 계열뿐이다. */
    static boolean minimalThinking(String model) {
        return model != null && model.startsWith("gemini-3-flash");
    }

    private String generate(Video video, List<Message> history, String instruction, List<String> categories, boolean light) {
        boolean classification = categories != null;
        Request request = request(video, history, instruction, categories, light);
        var response = hedged(() -> client.models.generateContent(model, request.contents(), request.config()),
                classification ? hedge.classify() : hedge.reply());
        if (request.trace() != null) request.trace().usage(response);
        // 한도에 걸려 끊긴 답은 중간에 잘린 글이다. 빈 답과 같이 다루어 연습 루프가 한 번 다시 쓰게 한다.
        if (!classification && outputLimitReached(response)) {
            throw new IllegalStateException("empty video coaching reply: output limit reached");
        }
        String text = response.text();
        if (text == null || text.isBlank()) throw new IllegalStateException("empty video coaching reply");
        return text.strip();
    }

    /**
     * 정한 시간 안에 답이 없으면 같은 요청을 한 번 더 보내고 먼저 성공한 답을 쓴다(SOMA-780). 둘 다 실패하면 처음 요청의
     * 오류를 던진다. 시간 전에 실패한 요청은 다시 보내지 않는다 — 예전처럼 부르는 쪽이 다룬다.
     */
    private static <T> T hedged(Supplier<T> call, java.time.Duration after) {
        if (after == null || after.isZero() || after.isNegative()) return call.get();
        CompletableFuture<T> first = CompletableFuture.supplyAsync(call, HEDGE_CALLS);
        try {
            return first.get(after.toMillis(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException slow) {
            CompletableFuture<T> second = CompletableFuture.supplyAsync(call, HEDGE_CALLS);
            return firstSuccess(first, second);
        } catch (ExecutionException | InterruptedException failed) {
            if (failed instanceof InterruptedException) Thread.currentThread().interrupt();
            throw unwrap(failed);
        }
    }

    static <T> T firstSuccess(CompletableFuture<T> first, CompletableFuture<T> second) {
        var winner = new CompletableFuture<T>();
        var failures = new AtomicInteger();
        var firstError = new AtomicReference<Throwable>();
        first.whenComplete((value, error) -> settle(winner, failures, firstError, value, error, true));
        second.whenComplete((value, error) -> settle(winner, failures, firstError, value, error, false));
        try {
            return winner.join();
        } catch (CompletionException failed) {
            throw unwrap(failed);
        }
    }

    private static <T> void settle(CompletableFuture<T> winner, AtomicInteger failures, AtomicReference<Throwable> firstError,
            T value, Throwable error, boolean original) {
        if (error == null) {
            winner.complete(value);
            return;
        }
        if (original) firstError.set(error);
        else firstError.compareAndSet(null, error);
        if (failures.incrementAndGet() == 2) winner.completeExceptionally(firstError.get());
    }

    /** 다시 보내기가 감싼 오류를 벗겨, 다시 보내지 않았을 때와 같은 오류를 던지게 한다. */
    static RuntimeException unwrap(Throwable error) {
        Throwable cause = error;
        while ((cause instanceof CompletionException || cause instanceof ExecutionException) && cause.getCause() != null) {
            cause = cause.getCause();
        }
        return cause instanceof RuntimeException runtime ? runtime : new IllegalStateException(cause);
    }

    private static boolean outputLimitReached(com.google.genai.types.GenerateContentResponse response) {
        return response.candidates().flatMap(candidates -> candidates.stream().findFirst())
                .flatMap(com.google.genai.types.Candidate::finishReason)
                .map(reason -> reason.knownEnum() == com.google.genai.types.FinishReason.Known.MAX_TOKENS)
                .orElse(false);
    }

    @Override
    public String compare(List<Video> videos, List<String> labels, String instruction) {
        if (videos.size() != labels.size()) throw new IllegalArgumentException("each video needs a label");
        List<Part> parts = new ArrayList<>();
        for (int i = 0; i < videos.size(); i++) {
            parts.add(Part.fromText(labels.get(i)));
            parts.add(Part.fromUri(videos.get(i).uri(), videos.get(i).mimeType()));
        }
        var config = GenerateContentConfig.builder()
                .systemInstruction(Content.fromParts(Part.fromText(instruction)))
                .httpOptions(HttpOptions.builder().timeout(180000).build())
                .thinkingConfig(model.startsWith("gemini-3")
                        ? ThinkingConfig.builder().thinkingLevel("LOW").build()
                        : ThinkingConfig.builder().thinkingBudget(0).build())
                .responseMimeType("application/json")
                .maxOutputTokens(8192);
        String text = client.models.generateContent(model,
                List.of(Content.builder().role("user").parts(parts).build()), config.build()).text();
        if (text == null || text.isBlank()) throw new IllegalStateException("empty video comparison");
        return text.strip();
    }

    @Override public void delete(Video video) {
        try {
            client.files.delete(video.name(), DeleteFileConfig.builder()
                    .httpOptions(HttpOptions.builder().timeout(15000).build()).build());
        } catch (com.google.genai.errors.ClientException failure) {
            // 이미 지워진 파일이다 — Gemini 는 없는 파일에 403("or it may not exist")·404를 준다. 지우는 경로가 여럿이라 겹칠 수 있다.
            if (failure.code() != 403 && failure.code() != 404) throw failure;
        }
    }
    @Override public String model() { return model; }
}
