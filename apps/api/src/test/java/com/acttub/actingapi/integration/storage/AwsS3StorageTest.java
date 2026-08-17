package com.acttub.actingapi.integration.storage;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Paths;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;

class AwsS3StorageTest {
    @Test
    void uploadPresignPinsTheConfiguredRegionalEndpoint() {
        try (AwsS3Storage storage = new AwsS3Storage(
                "videos",
                "ap-northeast-2",
                StaticCredentialsProvider.create(AwsBasicCredentials.create("key", "secret")))) {
            String url = storage.presignUpload(
                    "users/user-id/uploads/video.mp4",
                    "video/mp4",
                    12,
                    1800);

            assertThat(url).contains("s3.ap-northeast-2.amazonaws.com");
            assertThat(url).doesNotContain("s3.amazonaws.com/");
        }
    }

    /**
     * 부르는 쪽이 {@code createTempFile} 로 자리를 잡아 두고 그 경로를 넘기므로,
     * {@code getObject(request, Path)} 오버로드를 쓰면 <b>매번</b>
     * {@code FileAlreadyExistsException} 으로 죽는다. 실제로 그렇게 죽어서 분석이
     * 세 번 재시도 끝에 {@code max_attempts_exceeded} 로 끝났다. 되돌리기 쉬운
     * 한 줄이라 소스로 고정한다 — 진짜 S3 를 세우지 않는 테스트는 이 경로를 타지 않는다.
     */
    @Test
    @DisplayName("다운로드에 덮어쓰기 불가능한 Path 오버로드를 쓰지 않는다")
    void downloadNeverUsesTheNonOverwritingPathOverload() throws IOException {
        String source = Files.readString(
                Paths.get("src", "main", "java", "com", "acttub", "actingapi",
                        "integration", "storage", "AwsS3Storage.java"));

        assertThat(source)
                .describedAs("getObject(request, destination) 은 대상이 있으면 실패한다")
                .doesNotContain("build(),\n                destination)")
                .contains("StandardCopyOption.REPLACE_EXISTING");
    }
}
