package com.acttub.actingapi.storage;

import static org.assertj.core.api.Assertions.assertThat;

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
}
