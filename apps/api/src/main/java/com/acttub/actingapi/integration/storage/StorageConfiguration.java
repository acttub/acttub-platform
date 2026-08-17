package com.acttub.actingapi.integration.storage;

import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
class StorageConfiguration {
    @Bean
    ApplicationRunner validateStorageEnvironment(
            @Value("${S3_BUCKET:}") String bucket,
            @Value("${AWS_REGION:}") String region,
            @Value("${AWS_ACCESS_KEY_ID:}") String accessKey,
            @Value("${AWS_SECRET_ACCESS_KEY:}") String secretKey) {
        return arguments -> {
            if (bucket.isBlank() != region.isBlank()) {
                throw new IllegalStateException(
                        "S3_BUCKET and AWS_REGION must be configured together");
            }
            if (accessKey.isBlank() != secretKey.isBlank()) {
                throw new IllegalStateException(
                        "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be configured together");
            }
        };
    }

    @Bean(destroyMethod = "close")
    @ConditionalOnExpression("T(org.springframework.util.StringUtils).hasText('${S3_BUCKET:}')"
            + " && T(org.springframework.util.StringUtils).hasText('${AWS_REGION:}')")
    ObjectStorage objectStorage(
            @Value("${S3_BUCKET}") String bucket,
            @Value("${AWS_REGION}") String region) {
        return new AwsS3Storage(bucket, region, DefaultCredentialsProvider.create());
    }
}
