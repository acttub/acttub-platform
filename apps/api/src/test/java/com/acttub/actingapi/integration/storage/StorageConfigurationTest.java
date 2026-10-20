package com.acttub.actingapi.integration.storage;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.boot.ApplicationRunner;

/** 저장소 환경변수는 짝이 맞아야 기동한다 — 하나만 있으면 반쯤 설정된 채로 뜨지 않는다. */
class StorageConfigurationTest {
    private static final ApplicationArguments NO_ARGS = new DefaultApplicationArguments();

    private static ApplicationRunner check(String bucket, String region, String accessKey, String secretKey) {
        return new StorageConfiguration().validateStorageEnvironment(bucket, region, accessKey, secretKey);
    }

    @Test
    void bucketAndRegionMustBeSetTogether() throws Exception {
        check("", "", "", "").run(NO_ARGS);
        assertThatThrownBy(() -> check("videos", "", "", "").run(NO_ARGS))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("S3_BUCKET and AWS_REGION must be configured together");
    }

    @Test
    void accessKeyAndSecretMustBeSetTogether() throws Exception {
        check("videos", "ap-northeast-2", "AKIA", "secret").run(NO_ARGS);
        assertThatThrownBy(() -> check("videos", "ap-northeast-2", "AKIA", "").run(NO_ARGS))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be configured together");
    }
}
