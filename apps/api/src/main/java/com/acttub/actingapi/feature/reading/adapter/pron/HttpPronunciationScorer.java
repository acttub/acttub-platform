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
import com.acttub.actingapi.platform.json.LenientJson;

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
                phones.add(new Phone(LenientJson.asText(p.path("expected")), LenientJson.asText(p.path("heard")), LenientJson.asDouble(p.path("lpr")),
                        LenientJson.asBoolean(p.path("vowel")), intOrNull(p.get("syllable")), intOrNull(p.get("start_ms")),
                        intOrNull(p.get("end_ms")), LenientJson.asBoolean(p.path("flagged"))));
            }
            words.add(new Word(LenientJson.asInt(w.path("index")), LenientJson.asText(w.path("word")), LenientJson.asBoolean(w.path("number")), phones));
        }
        JsonNode match = root.get("script_match");
        Double scriptMatch = match == null || match.isNull() ? null : LenientJson.asDouble(match);
        return new Scored(new ScoredLine(LenientJson.asText(root.path("scored_text"), null), words, scriptMatch),
                LenientJson.asText(root.path("model_version"), null));
    }

    private static Integer intOrNull(JsonNode node) {
        return node == null || node.isNull() ? null : LenientJson.asInt(node);
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
