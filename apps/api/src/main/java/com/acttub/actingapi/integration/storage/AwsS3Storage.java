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
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3ClientBuilder;
import software.amazon.awssdk.services.s3.S3Configuration;
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

/**
 * 실제 S3 경계. endpoint 가 비면 AWS 이고, presign endpoint는 global이 아니라 설정된 region에 고정한다.
 * endpoint 가 있으면 그 주소의 S3 호환 저장소(Cloudflare R2 등)에 경로 방식(주소/버킷/키)으로 붙는다.
 */
public final class AwsS3Storage implements ObjectStorage, AutoCloseable {
    private final String bucket;
    private final AwsCredentialsProvider credentials;
    private final S3Client client;
    private final S3Presigner presigner;

    public AwsS3Storage(
            String bucket,
            String regionName,
            String endpoint,
            AwsCredentialsProvider credentials) {
        if (bucket == null || bucket.isBlank()) {
            throw new IllegalArgumentException("S3 bucket must not be empty");
        }
        Region region = Region.of(regionName);
        boolean compatible = endpoint != null && !endpoint.isBlank();
        URI endpointUri = URI.create(compatible
                ? endpoint.strip()
                : "https://s3." + region.id() + ".amazonaws.com");
        this.bucket = bucket;
        this.credentials = credentials;
        S3ClientBuilder clientBuilder = S3Client.builder()
                .region(region)
                .endpointOverride(endpointUri)
                .credentialsProvider(credentials);
        S3Presigner.Builder presignerBuilder = S3Presigner.builder()
                .region(region)
                .endpointOverride(endpointUri)
                .credentialsProvider(credentials);
        if (compatible) {
            // 버킷 이름이 호스트에 들어가지 않게 한다 — S3 호환 저장소가 모두 받는 방식이고 호스트가 하나로 고정된다.
            S3Configuration pathStyle = S3Configuration.builder().pathStyleAccessEnabled(true).build();
            clientBuilder.serviceConfiguration(pathStyle);
            presignerBuilder.serviceConfiguration(pathStyle);
        }
        this.client = clientBuilder.build();
        this.presigner = presignerBuilder.build();
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
    public void upload(String objectKey, String mimeType, Path source) {
        resolveCredentials();
        client.putObject(PutObjectRequest.builder()
                .bucket(bucket)
                .key(objectKey)
                .contentType(mimeType)
                .build(), RequestBody.fromFile(source));
    }

    @Override
    public void upload(String objectKey, String mimeType, byte[] content) {
        resolveCredentials();
        client.putObject(PutObjectRequest.builder().bucket(bucket).key(objectKey).contentType(mimeType).build(),
                RequestBody.fromBytes(content));
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
