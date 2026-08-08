package com.acttub.actingapi.storage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class ContractObjectStorageTest {
    private static final Path FIXTURE = Path.of(
            "../../tools/contract-harness/contract_harness/fixtures/s3.json");

    private final ContractObjectStorage storage = ContractObjectStorage.load(
            new ObjectMapper(), FIXTURE, "harness-videos");

    @Test
    void presignedUrlsUseEveryQueryKeyAndConfiguredRegion() {
        String upload = storage.presignUpload("users/u/video.mp4", "video/mp4", 12, 1800);
        String playback = storage.presignPlayback("users/u/video.mp4", 900);

        assertThat(upload).startsWith(
                "https://s3.ap-northeast-2.amazonaws.com/harness-videos/users/u/video.mp4?");
        assertThat(playback).startsWith(
                "https://s3.ap-northeast-2.amazonaws.com/harness-videos/users/u/video.mp4?");
        assertThat(queryKeys(upload)).containsExactlyInAnyOrder(
                "X-Amz-Algorithm",
                "X-Amz-Credential",
                "X-Amz-Date",
                "X-Amz-Expires",
                "X-Amz-SignedHeaders",
                "X-Amz-Signature");
        assertThat(upload).contains("X-Amz-Expires=1800");
        assertThat(playback).contains("X-Amz-Expires=900");
    }

    @Test
    void headAndDownloadFollowSuffixRulesFromSharedFixture() throws Exception {
        storage.presignUpload("remembered.mp4", "video/mp4", 12, 1800);

        assertThat(storage.head("remembered.mp4"))
                .isEqualTo(new StoredObjectMetadata(
                        12, "video/mp4", "\"9f86d081884c7d659a2feaa0c55ad015\""));
        assertThat(storage.head("missing.xmissing")).isNull();
        assertThat(storage.head("wrong.xsizebad").sizeBytes()).isEqualTo(4097);

        Path destination = Files.createTempFile("contract-storage-", ".mp4");
        StoredObjectMetadata downloaded = storage.downloadToPath(
                "wrong.xetagbad", destination);
        assertThat(Files.size(destination)).isEqualTo(4096);
        assertThat(Files.readAllBytes(destination)).containsOnly((byte) 78);
        assertThat(downloaded.etag()).isEqualTo("\"0000000000000000000000000000dead\"");
    }

    @Test
    void exceptionalSuffixesFollowSharedFixture() {
        assertThatThrownBy(() -> storage.presignUpload(
                "video.xnocreds", "video/x-nocreds", 12, 1800))
                .isInstanceOf(NoCredentialsError.class);
        assertThatThrownBy(() -> storage.presignPlayback("video.xpresignbad", 900))
                .isInstanceOf(RuntimeException.class)
                .hasMessage("harness: presign failed");
    }

    private static Set<String> queryKeys(String url) {
        String query = url.substring(url.indexOf('?') + 1);
        return java.util.Arrays.stream(query.split("&"))
                .map(item -> item.substring(0, item.indexOf('=')))
                .collect(java.util.stream.Collectors.toSet());
    }
}
