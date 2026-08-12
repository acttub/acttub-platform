package com.acttub.actingapi.analysis;

import java.io.IOException;
import java.net.URI;
import java.nio.file.Path;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/** OpenAI audio/transcriptions REST 호출. 설정은 생성 클라이언트와 같이 호출 시 읽는다. */
public final class OpenAiAudioTranscriber implements AudioTranscriber {
    static final URI TRANSCRIPTIONS_URI =
            URI.create("https://api.openai.com/v1/audio/transcriptions");
    static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(120);
    static final int ATTEMPTS = 4;
    static final String DEFAULT_MODEL = "gpt-transcribe";
    static final String FILE_FIELD = "file";
    static final String FILE_NAME = "audio.mp3";
    static final String FILE_CONTENT_TYPE = "audio/mpeg";
    private static final Set<Integer> RETRY_STATUSES = Set.of(429, 503);

    private final ObjectMapper mapper;
    private final OpenAiTranscriptionTransport transport;
    private final Sleeper sleeper;
    private final Function<String, String> environment;

    public OpenAiAudioTranscriber(ObjectMapper mapper) {
        this(
                mapper,
                new RestClientOpenAiTranscriptionTransport(REQUEST_TIMEOUT),
                Sleeper.real(),
                System::getenv);
    }

    OpenAiAudioTranscriber(
            ObjectMapper mapper,
            OpenAiTranscriptionTransport transport,
            Sleeper sleeper,
            Function<String, String> environment) {
        this.mapper = mapper;
        this.transport = transport;
        this.sleeper = sleeper;
        this.environment = environment;
    }

    @Override
    public String transcribe(Path audioPath, String prompt) {
        String apiKey = value("OPENAI_API_KEY");
        if (apiKey.isEmpty()) {
            throw new IllegalStateException(
                    "OpenAI 호출에는 OPENAI_API_KEY 환경변수가 필요합니다.");
        }
        String configuredModel = value("OPENAI_TRANSCRIBE_MODEL");
        String model = configuredModel.isEmpty() ? DEFAULT_MODEL : configuredModel;
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Authorization", "Bearer " + apiKey);
        TranscriptionRequest request = new TranscriptionRequest(
                TRANSCRIPTIONS_URI,
                headers,
                model,
                "json",
                prompt,
                FILE_FIELD,
                FILE_NAME,
                FILE_CONTENT_TYPE,
                audioPath);
        TranscriptionResponse response = retry(request);
        if (response.status() < 200 || response.status() >= 300) {
            throw apiError(response.status());
        }
        try {
            JsonNode payload = mapper.readTree(response.body());
            JsonNode text = payload == null ? null : payload.get("text");
            if (text == null || !text.isTextual()) {
                throw new IllegalStateException("OpenAI 받아쓰기 결과를 읽지 못했습니다.");
            }
            return text.textValue();
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("OpenAI 받아쓰기 결과를 읽지 못했습니다.", exception);
        }
    }

    private TranscriptionResponse retry(TranscriptionRequest request) {
        Duration delay = Duration.ofSeconds(1);
        for (int attempt = 0; attempt < ATTEMPTS; attempt++) {
            TranscriptionResponse response = null;
            try {
                response = transport.exchange(request);
            } catch (IOException exception) {
                if (attempt == ATTEMPTS - 1) {
                    throw new IllegalStateException(exception);
                }
            }
            if (response != null && !RETRY_STATUSES.contains(response.status())) {
                return response;
            }
            if (response != null && attempt == ATTEMPTS - 1) {
                return response;
            }
            sleeper.sleep(delay);
            delay = delay.multipliedBy(2);
        }
        throw new IllegalStateException("OpenAI 전사 요청을 완료하지 못했습니다.");
    }

    private String value(String name) {
        String raw = environment.apply(name);
        return raw == null ? "" : raw.strip();
    }

    private static IllegalStateException apiError(int status) {
        if (RETRY_STATUSES.contains(status)) {
            return new IllegalStateException(
                    "OpenAI 받아쓰기 실패: 지금 AI가 붐빕니다. 잠시 뒤 다시 시도해 주세요.");
        }
        return new IllegalStateException(
                "OpenAI 받아쓰기 실패: OpenAI가 HTTP " + status + "로 응답했습니다.");
    }

    record TranscriptionRequest(
            URI uri,
            Map<String, String> headers,
            String model,
            String responseFormat,
            String prompt,
            String fileField,
            String fileName,
            String fileContentType,
            Path audioPath) {
    }

    record TranscriptionResponse(int status, String body) {
    }

    @FunctionalInterface
    interface OpenAiTranscriptionTransport {
        TranscriptionResponse exchange(TranscriptionRequest request) throws IOException;
    }

    @FunctionalInterface
    interface Sleeper {
        void sleep(Duration duration);

        static Sleeper real() {
            return duration -> {
                try {
                    Thread.sleep(duration);
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("전사 재시도 대기가 중단됐습니다.", exception);
                }
            };
        }
    }
}
