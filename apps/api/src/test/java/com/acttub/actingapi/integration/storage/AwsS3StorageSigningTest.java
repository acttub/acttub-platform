package com.acttub.actingapi.integration.storage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;

/** 네트워크 없이 볼 수 있는 S3 경계 — 재생 링크 서명, 자격 증명 없음, 빈 버킷. */
class AwsS3StorageSigningTest {
    private static final String KEY = "users/u1/uploads/take.mp4";

    @Test
    void playbackLinkIsSignedForTheRegionalEndpoint() {
        try (AwsS3Storage storage = new AwsS3Storage("videos", "ap-northeast-2",
                StaticCredentialsProvider.create(AwsBasicCredentials.create("key", "secret")))) {
            String url = storage.presignPlayback(KEY, 600);

            assertThat(url).startsWith("https://videos.s3.ap-northeast-2.amazonaws.com/" + KEY + "?");
            assertThat(url).contains("X-Amz-Expires=600");
        }
    }

    @Test
    void missingCredentialsAreAStorageConfigurationErrorBeforeAnyRequest() {
        try (AwsS3Storage unconfigured = new AwsS3Storage("videos", "ap-northeast-2", () -> {
            throw new IllegalStateException("no credentials in the chain");
        })) {
            assertThatThrownBy(() -> unconfigured.head(KEY))
                    .isInstanceOf(NoCredentialsError.class)
                    .hasMessage("no credentials in the chain");
            assertThatThrownBy(() -> unconfigured.presignPlayback(KEY, 600))
                    .isInstanceOf(NoCredentialsError.class);
            assertThatThrownBy(() -> unconfigured.delete(KEY))
                    .isInstanceOf(NoCredentialsError.class);
        }
    }

    @Test
    void blankBucketIsRejected() {
        assertThatThrownBy(() -> new AwsS3Storage(" ", "ap-northeast-2",
                StaticCredentialsProvider.create(AwsBasicCredentials.create("key", "secret"))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("S3 bucket must not be empty");
        assertThatThrownBy(() -> new AwsS3Storage(null, "ap-northeast-2",
                StaticCredentialsProvider.create(AwsBasicCredentials.create("key", "secret"))))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
