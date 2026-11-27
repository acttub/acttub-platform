package com.acttub.actingapi.support;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/**
 * 메모리 객체 저장소. 객체는 키와 크기만 남는다. 기기가 서명 주소로 올린 객체는 테스트가 {@link #put} 으로 만든다.
 *
 * <p>컨텍스트에 하나라 설정이 같은 테스트 클래스끼리 같이 쓴다. {@code @BeforeEach} 에서 {@link #clear()} 한다.
 */
public final class FakeObjectStorage implements ObjectStorage {
    /** 기기가 올렸다고 칠 때 {@link #put(String...)} 이 적는 크기. */
    public static final long PUT_SIZE = 100L;

    /** 객체 키 → 크기. */
    public final Map<String, Long> objects = new ConcurrentHashMap<>();
    /** 서버가 직접 올린 객체의 형식. */
    public final Map<String, String> contentTypes = new ConcurrentHashMap<>();
    /** 객체 키 → 검증값. 없으면 키에서 만든다. 같은 키에 다른 파일이 올라온 것을 흉내 낼 때 넣는다. */
    public final Map<String, String> etags = new ConcurrentHashMap<>();
    /** 지우기를 거절할 키. */
    public final Set<String> failing = ConcurrentHashMap.newKeySet();
    /** 올리기 주소를 받은 키. */
    public final List<String> presigned = new CopyOnWriteArrayList<>();
    /** 올리기 직전에 부른다. 겹친 올리기의 순서를 맞출 때만 쓴다. */
    public volatile Consumer<String> beforeUpload;

    public void clear() {
        objects.clear();
        contentTypes.clear();
        etags.clear();
        failing.clear();
        presigned.clear();
        beforeUpload = null;
    }

    public void put(String objectKey, long sizeBytes) {
        objects.put(objectKey, sizeBytes);
    }

    public void put(String... objectKeys) {
        for (String objectKey : objectKeys) {
            objects.put(objectKey, PUT_SIZE);
        }
    }

    @Override
    public String presignUpload(String objectKey, String mimeType, long sizeBytes, int expiresInSeconds) {
        presigned.add(objectKey);
        return "https://storage.test/put/" + objectKey;
    }

    @Override
    public String presignPlayback(String objectKey, int expiresInSeconds) {
        return "https://storage.test/get/" + objectKey;
    }

    @Override
    public StoredObjectMetadata head(String objectKey) {
        Long size = objects.get(objectKey);
        return size == null ? null : metadata(objectKey, size);
    }

    /** 내용은 보지 않는 테스트만 쓴다. 받은 파일에는 키만 적는다. */
    @Override
    public StoredObjectMetadata downloadToPath(String objectKey, Path destination) {
        Long size = objects.get(objectKey);
        if (size == null) {
            throw new IllegalStateException("no such object");
        }
        try {
            Files.writeString(destination, objectKey);
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        }
        return metadata(objectKey, size);
    }

    @Override
    public void upload(String objectKey, String mimeType, Path source) {
        Consumer<String> hook = beforeUpload;
        if (hook != null) {
            hook.accept(objectKey);
        }
        try {
            objects.put(objectKey, Files.size(source));
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        }
        contentTypes.put(objectKey, mimeType);
    }

    @Override
    public void delete(String objectKey) {
        if (failing.contains(objectKey)) {
            throw new IllegalStateException("storage refused the delete");
        }
        objects.remove(objectKey);
        contentTypes.remove(objectKey);
        etags.remove(objectKey);
    }

    private StoredObjectMetadata metadata(String objectKey, long size) {
        return new StoredObjectMetadata(
                size,
                contentTypes.getOrDefault(objectKey, "application/octet-stream"),
                etags.getOrDefault(objectKey, "etag-" + objectKey.hashCode()));
    }

    /** {@code @Import(FakeObjectStorage.Fixture.class)} 로 객체 저장소를 이 가짜로 바꾼다. */
    @TestConfiguration(proxyBeanMethods = false)
    public static class Fixture {
        @Bean
        @Primary
        FakeObjectStorage fakeObjectStorage() {
            return new FakeObjectStorage();
        }
    }
}
