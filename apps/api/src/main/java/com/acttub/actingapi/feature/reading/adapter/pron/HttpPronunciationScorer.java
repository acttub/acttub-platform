package com.acttub.actingapi.feature.reading.adapter.pron;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.PronunciationScorer;
import com.acttub.actingapi.feature.reading.domain.PronunciationRules.Phone;
import com.acttub.actingapi.feature.reading.domain.PronunciationRules.ScoredLine;
import com.acttub.actingapi.feature.reading.domain.PronunciationRules.Word;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/** 채점 서비스(apps/pron) {@code POST /score} 를 multipart 로 부른다. 같은 compose 네트워크 안의 내부 주소다. */
public class HttpPronunciationScorer implements PronunciationScorer {
    private static final Duration TIMEOUT = Duration.ofSeconds(90);

    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final URI endpoint;
    private final ObjectMapper mapper;

    public HttpPronunciationScorer(String baseUrl, ObjectMapper mapper) {
        this.endpoint = URI.create(withoutTrailingSlash(baseUrl) + "/score");
        this.mapper = mapper;
    }

    @Override
    public Scored score(Path audio, String contentType, String scriptText) {
        String boundary = "pron-" + UUID.randomUUID();
        try {
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            String ext = "audio/wav".equals(contentType) ? "wav" : "m4a";
            write(body, "--" + boundary + "\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"line." + ext
                    + "\"\r\nContent-Type: " + (contentType == null ? "audio/mp4" : contentType) + "\r\n\r\n");
            body.write(Files.readAllBytes(audio));
            write(body, "\r\n--" + boundary + "\r\nContent-Disposition: form-data; name=\"text\"\r\n\r\n" + scriptText
                    + "\r\n--" + boundary + "--\r\n");
            HttpResponse<String> response = client.send(HttpRequest.newBuilder(endpoint)
                    .timeout(TIMEOUT)
                    .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                    .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray()))
                    .build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() != 200) {
                throw new IllegalStateException("pronunciation scorer returned " + response.statusCode());
            }
            return parse(mapper.readTree(response.body()));
        } catch (IOException failure) {
            throw new IllegalStateException("pronunciation scorer failed", failure);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("pronunciation scorer interrupted", interrupted);
        }
    }

    static Scored parse(JsonNode root) {
        List<Word> words = new ArrayList<>();
        for (JsonNode w : root.path("words")) {
            List<Phone> phones = new ArrayList<>();
            for (JsonNode p : w.path("phones")) {
                phones.add(new Phone(p.path("expected").asText(), p.path("heard").asText(), p.path("lpr").asDouble(),
                        p.path("vowel").asBoolean(), intOrNull(p.get("syllable")), intOrNull(p.get("start_ms")),
                        intOrNull(p.get("end_ms")), p.path("flagged").asBoolean()));
            }
            words.add(new Word(w.path("index").asInt(), w.path("word").asText(), w.path("number").asBoolean(), phones));
        }
        JsonNode match = root.get("script_match");
        Double scriptMatch = match == null || match.isNull() ? null : match.asDouble();
        return new Scored(new ScoredLine(root.path("scored_text").asText(null), words, scriptMatch),
                root.path("model_version").asText(null));
    }

    private static Integer intOrNull(JsonNode node) {
        return node == null || node.isNull() ? null : node.asInt();
    }

    private static void write(ByteArrayOutputStream out, String s) {
        out.writeBytes(s.getBytes(StandardCharsets.UTF_8));
    }

    static String withoutTrailingSlash(String url) {
        int end = url.length();
        while (end > 0 && url.charAt(end - 1) == '/') {
            end -= 1;
        }
        return url.substring(0, end);
    }
}
