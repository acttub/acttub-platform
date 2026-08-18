package com.acttub.actingapi.integration.storage;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;

import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.core.ResponseInputStream;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;

/** 실제 S3 경계. presign endpoint는 global이 아니라 설정된 region에 고정한다. */
public final class AwsS3Storage implements ObjectStorage, AutoCloseable {
    private final String bucket;
    private final AwsCredentialsProvider credentials;
    private final S3Client client;
    private final S3Presigner presigner;

    public AwsS3Storage(
            String bucket,
            String regionName,
            AwsCredentialsProvider credentials) {
        if (bucket == null || bucket.isBlank()) {
            throw new IllegalArgumentException("S3 bucket must not be empty");
        }
        Region region = Region.of(regionName);
        URI regionalEndpoint = URI.create("https://s3." + region.id() + ".amazonaws.com");
        this.bucket = bucket;
        this.credentials = credentials;
        this.client = S3Client.builder()
                .region(region)
                .endpointOverride(regionalEndpoint)
                .credentialsProvider(credentials)
                .build();
        this.presigner = S3Presigner.builder()
                .region(region)
                .endpointOverride(regionalEndpoint)
                .credentialsProvider(credentials)
                .build();
    }

    @Override
    public String presignUpload(
            String objectKey,
            String mimeType,
            long sizeBytes,
            int expiresInSeconds) {
        resolveCredentials();
        PutObjectRequest request = PutObjectRequest.builder()
                .bucket(bucket)
                .key(objectKey)
                .contentType(mimeType)
                .contentLength(sizeBytes)
                .build();
        PutObjectPresignRequest presignRequest = PutObjectPresignRequest.builder()
                .signatureDuration(Duration.ofSeconds(expiresInSeconds))
                .putObjectRequest(request)
                .build();
        return presigner.presignPutObject(presignRequest).url().toString();
    }

    @Override
    public StoredObjectMetadata head(String objectKey) {
        resolveCredentials();
        try {
            var response = client.headObject(HeadObjectRequest.builder()
                    .bucket(bucket)
                    .key(objectKey)
                    .build());
            return new StoredObjectMetadata(
                    response.contentLength(),
                    response.contentType(),
                    response.eTag());
        } catch (NoSuchKeyException exception) {
            return null;
        } catch (S3Exception exception) {
            if (exception.statusCode() == 404) {
                return null;
            }
            throw exception;
        }
    }

    @Override
    public String presignPlayback(String objectKey, int expiresInSeconds) {
        resolveCredentials();
        GetObjectPresignRequest presignRequest = GetObjectPresignRequest.builder()
                .signatureDuration(Duration.ofSeconds(expiresInSeconds))
                .getObjectRequest(GetObjectRequest.builder()
                        .bucket(bucket)
                        .key(objectKey)
                        .build())
                .build();
        return presigner.presignGetObject(presignRequest).url().toString();
    }

    @Override
    public StoredObjectMetadata downloadToPath(String objectKey, Path destination) {
        resolveCredentials();
        // 부르는 쪽이 createTempFile 로 자리를 잡아 두고 그 경로를 넘긴다. Path 를 받는
        // getObject 오버로드는 대상이 **이미 있으면** FileAlreadyExistsException 으로
        // 죽으므로 쓸 수 없다(동기 클라이언트에는 덮어쓰기 설정이 없다). 스트림으로 받아
        // REPLACE_EXISTING 으로 옮긴다 — boto3 의 download_file 과 같은 의미다.
        try (ResponseInputStream<GetObjectResponse> stream = client.getObject(
                GetObjectRequest.builder().bucket(bucket).key(objectKey).build())) {
            GetObjectResponse response = stream.response();
            Files.copy(stream, destination, StandardCopyOption.REPLACE_EXISTING);
            return new StoredObjectMetadata(
                    response.contentLength(), response.contentType(), response.eTag());
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        }
    }

    @Override
    public void delete(String objectKey) {
        resolveCredentials();
        client.deleteObject(DeleteObjectRequest.builder()
                .bucket(bucket)
                .key(objectKey)
                .build());
    }

    private void resolveCredentials() {
        try {
            credentials.resolveCredentials();
        } catch (RuntimeException exception) {
            throw new NoCredentialsError(exception.getMessage());
        }
    }

    @Override
    public void close() {
        presigner.close();
        client.close();
    }
}
