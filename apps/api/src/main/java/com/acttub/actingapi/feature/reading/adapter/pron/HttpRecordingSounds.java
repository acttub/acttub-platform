package com.acttub.actingapi.feature.reading.adapter.pron;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.logging.Logger;

import com.acttub.actingapi.feature.reading.app.RecordingSounds;
import com.acttub.actingapi.feature.reading.domain.ReadingVoiceMaterial.Clip;
import com.acttub.actingapi.feature.reading.domain.RecordingSoundCues.Sound;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/** 채점 서비스(apps/pron) {@code POST /measure} 로 줄 녹음의 소리를 잰다(SOMA-791). 줄 하나의 실패는 그 줄만 뺀다. */
public class HttpRecordingSounds implements RecordingSounds {
    private static final Logger LOGGER = Logger.getLogger(HttpRecordingSounds.class.getName());
    private static final Duration TIMEOUT = Duration.ofSeconds(20);
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final URI endpoint;
    private final Supplier<ObjectStorage> storage;
    private final ObjectMapper mapper;

    public HttpRecordingSounds(String baseUrl, Supplier<ObjectStorage> storage, ObjectMapper mapper) {
        this.endpoint = URI.create(withoutTrailingSlash(baseUrl) + "/measure");
        this.storage = storage;
        this.mapper = mapper;
    }

    @Override
    public Map<Integer, Sound> measure(List<Clip> clips) {
        Map<Integer, Sound> out = new LinkedHashMap<>();
        for (Clip clip : clips) {
            try {
                Sound sound = measure(clip);
                if (sound != null) {
                    out.put(clip.number(), sound);
                }
            } catch (Exception failure) {
                if (failure instanceof InterruptedException) {
                    Thread.currentThread().interrupt();
                    break;
                }
                LOGGER.warning("recording coach sound not measured: clip=" + clip.number() + " cause=" + failure);
            }
        }
        return out;
    }

    private Sound measure(Clip clip) throws Exception {
        Path local = Files.createTempFile("recording-sound-", ".m4a",
                PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
        try {
            storage.get().downloadToPath(clip.objectKey(), local);
            String boundary = "measure-" + UUID.randomUUID();
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            String ext = "audio/wav".equals(clip.contentType()) ? "wav" : "m4a";
            body.writeBytes(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"line." + ext
                    + "\"\r\nContent-Type: " + (clip.contentType() == null ? "audio/mp4" : clip.contentType()) + "\r\n\r\n")
                    .getBytes(StandardCharsets.UTF_8));
            body.write(Files.readAllBytes(local));
            body.writeBytes(("\r\n--" + boundary + "\r\nContent-Disposition: form-data; name=\"text\"\r\n\r\n"
                    + (clip.text() == null ? "" : clip.text()) + "\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
            HttpResponse<String> response = client.send(HttpRequest.newBuilder(endpoint)
                    .timeout(TIMEOUT)
                    .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                    .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray()))
                    .build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() != 200) {
                throw new IllegalStateException("measure returned " + response.statusCode());
            }
            return parse(mapper.readTree(response.body()));
        } finally {
            Files.deleteIfExists(local);
        }
    }

    static Sound parse(JsonNode root) {
        if (!root.path("measured").asBoolean(false)) {
            return null;
        }
        return new Sound(root.path("loud_db").asDouble(), doubleOrNull(root.get("rate")), root.path("max_pause_ms").asInt(),
                doubleOrNull(root.get("end_semitones")), doubleOrNull(root.get("end_loud_db")), root.path("speech_ms").asInt());
    }

    private static Double doubleOrNull(JsonNode node) {
        return node == null || node.isNull() ? null : node.asDouble();
    }

    static String withoutTrailingSlash(String url) {
        int end = url.length();
        while (end > 0 && url.charAt(end - 1) == '/') {
            end -= 1;
        }
        return url.substring(0, end);
    }
}
