package com.acttub.actingapi.integration.storage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.time.Duration;
import java.util.function.Function;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;

/** 네트워크 없이 볼 수 있는 S3 경계 — 재생 링크 서명, 자격 증명 없음, 빈 버킷, 저장소 주소 설정. */
class AwsS3StorageSigningTest {
    private static final String KEY = "users/u1/uploads/take.mp4";
    private static final StaticCredentialsProvider CREDENTIALS =
            StaticCredentialsProvider.create(AwsBasicCredentials.create("key", "secret"));

    @Test
    void playbackLinkIsSignedForTheRegionalEndpoint() {
        try (AwsS3Storage storage = new AwsS3Storage("videos", "ap-northeast-2", null,
                StaticCredentialsProvider.create(AwsBasicCredentials.create("key", "secret")))) {
            String url = storage.presignPlayback(KEY, 600);

            assertThat(url).startsWith("https://videos.s3.ap-northeast-2.amazonaws.com/" + KEY + "?");
            assertThat(url).contains("X-Amz-Expires=600");
        }
    }

    @Test
    void missingCredentialsAreAStorageConfigurationErrorBeforeAnyRequest() {
        try (AwsS3Storage unconfigured = new AwsS3Storage("videos", "ap-northeast-2", null, () -> {
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
        assertThatThrownBy(() -> new AwsS3Storage(" ", "ap-northeast-2", null,
                StaticCredentialsProvider.create(AwsBasicCredentials.create("key", "secret"))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("S3 bucket must not be empty");
        assertThatThrownBy(() -> new AwsS3Storage(null, "ap-northeast-2", null,
                StaticCredentialsProvider.create(AwsBasicCredentials.create("key", "secret"))))
                .isInstanceOf(IllegalArgumentException.class);
    }

    /**
     * S3_ENDPOINT 가 비면 주소 설정이 생기기 전과 같은 주소·서명을 낸다. 기준은 그 전의 생성 코드를 그대로 옮긴 것이다.
     * 서명에 초 단위 시각이 들어가므로 기준을 앞뒤로 두 번 만들어 같은 초 안에서 만든 것만 비교한다.
     */
    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"", "  "})
    void withoutEndpointPresignedLinksMatchThePreviousAwsBuilderExactly(String endpoint) {
        try (S3Presigner previous = S3Presigner.builder()
                        .region(Region.of("ap-northeast-2"))
                        .endpointOverride(URI.create("https://s3.ap-northeast-2.amazonaws.com"))
                        .credentialsProvider(CREDENTIALS)
                        .build();
                AwsS3Storage storage = new AwsS3Storage("videos", "ap-northeast-2", endpoint, CREDENTIALS)) {
            assertSameWithinOneSecond(
                    () -> previous.presignPutObject(PutObjectPresignRequest.builder()
                            .signatureDuration(Duration.ofSeconds(1800))
                            .putObjectRequest(PutObjectRequest.builder()
                                    .bucket("videos").key(KEY).contentType("video/mp4").contentLength(12L).build())
                            .build()).url().toString(),
                    () -> storage.presignUpload(KEY, "video/mp4", 12, 1800));
            assertSameWithinOneSecond(
                    () -> previous.presignGetObject(GetObjectPresignRequest.builder()
                            .signatureDuration(Duration.ofSeconds(600))
                            .getObjectRequest(GetObjectRequest.builder().bucket("videos").key(KEY).build())
                            .build()).url().toString(),
                    () -> storage.presignPlayback(KEY, 600));
        }
    }

    @Test
    void compatibleEndpointSignsPathStyleLinksForThatHost() {
        try (AwsS3Storage storage = new AwsS3Storage("videos", "auto",
                " https://account.r2.cloudflarestorage.com ", CREDENTIALS)) {
            String playback = storage.presignPlayback(KEY, 600);
            String upload = storage.presignUpload(KEY, "video/mp4", 12, 1800);

            for (String url : new String[] {playback, upload}) {
                assertThat(url).startsWith("https://account.r2.cloudflarestorage.com/videos/" + KEY + "?");
                assertThat(url).contains("%2Fauto%2Fs3%2Faws4_request");
                assertThat(url).doesNotContain("amazonaws.com");
            }
            assertThat(upload).contains("X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost");
        }
    }

    private static void assertSameWithinOneSecond(
            java.util.function.Supplier<String> previous, java.util.function.Supplier<String> current) {
        Function<String, String> date = url -> url.replaceAll(".*X-Amz-Date=([0-9TZ]+).*", "$1");
        for (int attempt = 0; attempt < 5; attempt++) {
            String before = previous.get();
            String actual = current.get();
            String after = previous.get();
            if (before.equals(after)) {
                assertThat(actual).isEqualTo(before);
                return;
            }
            assertThat(date.apply(before)).isNotEqualTo(date.apply(after));
        }
        throw new AssertionError("서명 시각이 계속 초 경계에 걸렸다");
    }
}
