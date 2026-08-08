package com.acttub.actingapi.storage;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Primary;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/** contract 프로파일에서 외부 S3 호출을 막는 결정적 경계 구현. */
@Component
@Primary
@Profile("contract")
final class ContractObjectStorage implements ObjectStorage {
    private final Document fixture;
    private final String bucket;
    private final Map<String, Long> sizes = new ConcurrentHashMap<>();

    @Autowired
    ContractObjectStorage(
            ObjectMapper mapper,
            @Value("${contract.s3-fixture}") String fixturePath,
            @Value("${S3_BUCKET:harness-videos}") String bucket) {
        this(loadDocument(mapper, Path.of(fixturePath)), bucket);
    }

    private ContractObjectStorage(Document fixture, String bucket) {
        this.fixture = fixture;
        this.bucket = bucket;
    }

    static ContractObjectStorage load(ObjectMapper mapper, Path fixturePath, String bucket) {
        return new ContractObjectStorage(loadDocument(mapper, fixturePath), bucket);
    }

    private static Document loadDocument(ObjectMapper mapper, Path path) {
        try {
            return mapper.readValue(path.toFile(), Document.class);
        } catch (IOException exception) {
            throw new IllegalStateException(
                    "cannot read contract S3 fixture: " + path.toAbsolutePath(), exception);
        }
    }

    @Override
    public String presignUpload(
            String objectKey,
            String mimeType,
            long sizeBytes,
            int expiresInSeconds) {
        sizes.put(objectKey, sizeBytes);
        return presign("PUT", objectKey, expiresInSeconds);
    }

    @Override
    public String presignPlayback(String objectKey, int expiresInSeconds) {
        if (objectKey.endsWith(fixture.playbackPresignFailureSuffix())) {
            throw new RuntimeException("harness: presign failed");
        }
        return presign("GET", objectKey, expiresInSeconds);
    }

    @Override
    public StoredObjectMetadata head(String objectKey) {
        if ("missing".equals(rule(fixture.headRules(), objectKey))) {
            return null;
        }
        long size = sizes.getOrDefault(objectKey, fixture.defaultObject().sizeBytes());
        if ("size_mismatch".equals(rule(fixture.headRules(), objectKey))) {
            size++;
        }
        return new StoredObjectMetadata(
                size,
                fixture.defaultObject().contentType(),
                fixture.defaultObject().etag());
    }

    @Override
    public StoredObjectMetadata downloadToPath(String objectKey, Path destination) {
        long size = sizes.getOrDefault(objectKey, fixture.defaultObject().sizeBytes());
        byte[] content = new byte[Math.toIntExact(size)];
        java.util.Arrays.fill(content, (byte) Integer.parseInt(fixture.downloadBodyRepeatByte()));
        try {
            Path parent = destination.getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            Files.write(destination, content);
        } catch (IOException exception) {
            throw new IllegalStateException("cannot write contract S3 object", exception);
        }
        String etag = "etag_mismatch".equals(rule(fixture.downloadRules(), objectKey))
                ? "\"0000000000000000000000000000dead\""
                : fixture.defaultObject().etag();
        return new StoredObjectMetadata(
                size,
                fixture.defaultObject().contentType(),
                etag);
    }

    @Override
    public void delete(String objectKey) {
        sizes.remove(objectKey);
    }

    private String presign(String verb, String objectKey, int expiresInSeconds) {
        if (objectKey.endsWith(fixture.credentialsErrorSuffix())) {
            throw new NoCredentialsError("harness: credentials unavailable");
        }
        Map<String, String> values = Map.of(
                "X-Amz-Algorithm", "AWS4-HMAC-SHA256",
                "X-Amz-Credential", "HARNESSKEY/20260101/"
                        + fixture.region() + "/s3/aws4_request",
                "X-Amz-Date", "20260101T000000Z",
                "X-Amz-Expires", Integer.toString(expiresInSeconds),
                "X-Amz-SignedHeaders", "host",
                "X-Amz-Signature", signature(verb, objectKey, expiresInSeconds));
        String query = fixture.presign().queryKeys().stream()
                .map(key -> key + "=" + encode(values.get(key)))
                .collect(java.util.stream.Collectors.joining("&"));
        String path = java.util.Arrays.stream(objectKey.split("/", -1))
                .map(ContractObjectStorage::encode)
                .collect(java.util.stream.Collectors.joining("/"));
        return "https://s3." + fixture.region() + ".amazonaws.com/"
                + bucket + "/" + path + "?" + query;
    }

    private String signature(String verb, String objectKey, int expiresInSeconds) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(
                    (verb + "|" + bucket + "|" + objectKey + "|" + expiresInSeconds)
                            .getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private static String rule(List<Rule> rules, String objectKey) {
        return rules.stream()
                .filter(rule -> objectKey.endsWith(rule.objectKeySuffix()))
                .map(Rule::result)
                .findFirst()
                .orElse(null);
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record Document(
            String region,
            @JsonProperty("default_object") DefaultObject defaultObject,
            @JsonProperty("download_body_repeat_byte") String downloadBodyRepeatByte,
            Presign presign,
            @JsonProperty("credentials_error_suffix") String credentialsErrorSuffix,
            @JsonProperty("head_rules") List<Rule> headRules,
            @JsonProperty("download_rules") List<Rule> downloadRules,
            @JsonProperty("playback_presign_failure_suffix")
            String playbackPresignFailureSuffix) {
    }

    private record DefaultObject(
            @JsonProperty("size_bytes") long sizeBytes,
            @JsonProperty("content_type") String contentType,
            String etag) {
    }

    private record Presign(@JsonProperty("query_keys") List<String> queryKeys) {
    }

    private record Rule(
            @JsonProperty("object_key_suffix") String objectKeySuffix,
            String result) {
    }
}
