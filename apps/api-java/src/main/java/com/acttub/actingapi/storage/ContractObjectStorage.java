package com.acttub.actingapi.storage;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.context.annotation.Primary;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/** contract 프로파일에서 외부 S3 호출을 막는 결정적 경계 구현. */
@Component
@Primary
@Profile("contract")
final class ContractObjectStorage implements ObjectStorage {
    private static final String REGION = "ap-northeast-2";
    private static final String BUCKET = "harness-videos";
    private static final String ETAG = "\"9f86d081884c7d659a2feaa0c55ad015\"";

    private final Map<String, Long> sizes = new ConcurrentHashMap<>();

    @Override
    public String presignUpload(
            String objectKey,
            String mimeType,
            long sizeBytes,
            int expiresInSeconds) {
        if (objectKey.endsWith(".xnocreds")) {
            throw new NoCredentialsError("harness: credentials unavailable");
        }
        sizes.put(objectKey, sizeBytes);
        String path = URLEncoder.encode(objectKey, StandardCharsets.UTF_8)
                .replace("%2F", "/");
        return "https://s3." + REGION + ".amazonaws.com/" + BUCKET + "/" + path
                + "?X-Amz-Expires=" + expiresInSeconds;
    }

    @Override
    public StoredObjectMetadata head(String objectKey) {
        if (objectKey.endsWith(".xmissing")) {
            return null;
        }
        long size = sizes.getOrDefault(objectKey, 4096L);
        if (objectKey.endsWith(".xsizebad")) {
            size++;
        }
        return new StoredObjectMetadata(size, "video/mp4", ETAG);
    }
}
