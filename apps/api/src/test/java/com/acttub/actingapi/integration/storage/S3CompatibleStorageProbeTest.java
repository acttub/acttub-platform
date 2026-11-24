package com.acttub.actingapi.integration.storage;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.List;
import java.util.Random;
import java.util.UUID;

import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import software.amazon.awssdk.auth.credentials.EnvironmentVariableCredentialsProvider;
import software.amazon.awssdk.awscore.exception.AwsServiceException;

/**
 * 실제 S3 호환 저장소(Cloudflare R2)에 {@link AwsS3Storage} 가 하는 호출과, 앱·웹이 미리 서명한 주소로 하는 요청을
 * 하나씩 돌려 호출마다 통과·실패를 남긴다. CI 와 평소 테스트에서는 S3_ENDPOINT 가 없어 건너뛴다.
 *
 * <p>읽는 환경 변수는 S3_BUCKET·AWS_REGION·AWS_ACCESS_KEY_ID·AWS_SECRET_ACCESS_KEY·S3_ENDPOINT 뿐이다. 버킷 안에서는
 * {@code _probe/<무작위>/} 아래에만 쓰고 끝에 지운다. 실패 메시지에는 상태 코드·오류 코드·참거짓만 담고 키·서명 주소·
 * 응답 본문은 담지 않는다. 버킷 수준 호출(목록·생성·설정 읽기)은 하지 않는다 — 앱도 하지 않는다.
 *
 * <pre>
 * S3_BUCKET=… AWS_REGION=auto AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… S3_ENDPOINT=https://&lt;계정 id&gt;.r2.cloudflarestorage.com \
 *   ./gradlew test --tests '*S3CompatibleStorageProbeTest' --no-daemon
 * </pre>
 */
@EnabledIfEnvironmentVariable(named = "S3_ENDPOINT", matches = ".+")
class S3CompatibleStorageProbeTest {
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    private final String prefix = "_probe/" + UUID.randomUUID() + "/";
    private final String presignedKey = prefix + "presigned.mp4";
    private final String fileKey = prefix + "server-file.m4a";
    private final String bytesKey = prefix + "server-bytes.jpg";
    private final List<String> written = new ArrayList<>(List.of(presignedKey, fileKey, bytesKey,
            prefix + "wrong-type.mp4", prefix + "wrong-length.mp4"));
    private final byte[] video = randomBytes(3 * 1024 * 1024 + 17, 1);
    private final byte[] audio = randomBytes(20 * 1024 * 1024 + 3, 2);
    private final byte[] image = randomBytes(54_321, 3);

    @TestFactory
    List<DynamicTest> everyStorageCall() throws Exception {
        AwsS3Storage storage = new AwsS3Storage(
                System.getenv("S3_BUCKET"), System.getenv("AWS_REGION"), System.getenv("S3_ENDPOINT"),
                EnvironmentVariableCredentialsProvider.create());
        Path download = Files.createTempFile("s3-probe-", ".bin");
        Path source = Files.createTempFile("s3-probe-src-", ".m4a");
        Files.write(source, audio);
        String[] headETag = new String[1];

        return List.of(
                step("01 미리 서명한 PUT(앱·웹의 영상·사진 올리기) → 200", () -> {
                    int status = put(storage.presignUpload(presignedKey, "video/mp4", video.length, 600), "video/mp4", video);
                    check(status == 200, "status=" + status);
                }),
                step("02 서명과 다른 Content-Type 으로 PUT → 403", () -> {
                    int status = put(storage.presignUpload(prefix + "wrong-type.mp4", "video/mp4", 4, 600),
                            "image/png", new byte[] {1, 2, 3, 4});
                    check(status == 403, "status=" + status);
                }),
                step("03 서명보다 큰 본문으로 PUT → 403", () -> {
                    int status = put(storage.presignUpload(prefix + "wrong-length.mp4", "video/mp4", 4, 600),
                            "video/mp4", new byte[] {1, 2, 3, 4, 5});
                    check(status == 403, "status=" + status);
                    check(storage.head(prefix + "wrong-length.mp4") == null, "객체가 생겼다");
                }),
                step("04 head(완료 확인) → 크기·Content-Type·ETag", () -> {
                    StoredObjectMetadata meta = storage.head(presignedKey);
                    check(meta != null, "head=null");
                    check(meta.sizeBytes() == video.length, "size=" + meta.sizeBytes());
                    check("video/mp4".equals(meta.contentType()), "contentType=" + meta.contentType());
                    check(meta.etag() != null, "etag=null");
                    headETag[0] = meta.etag();
                }),
                step("05 미리 서명한 PUT 객체의 ETag 가 본문 MD5(따옴표 포함) → 복사 대조 기준", () -> {
                    check(("\"" + md5(video) + "\"").equals(headETag[0]), "etag 형식이 MD5 가 아니다: " + shape(headETag[0]));
                }),
                step("06 미리 서명한 GET(재생) → 200·같은 바이트·Content-Type", () -> {
                    HttpResponse<byte[]> response = get(storage.presignPlayback(presignedKey, 600), null);
                    check(response.statusCode() == 200, "status=" + response.statusCode());
                    check(Arrays.equals(response.body(), video), "바이트가 다르다");
                    String type = response.headers().firstValue("Content-Type").orElse("-");
                    check("video/mp4".equals(type), "Content-Type=" + type);
                }),
                step("07 미리 서명한 GET + Range bytes=1000-1999(영상 재생·ffprobe) → 206", () -> {
                    HttpResponse<byte[]> response = get(storage.presignPlayback(presignedKey, 600), "bytes=1000-1999");
                    check(response.statusCode() == 206, "status=" + response.statusCode());
                    check(Arrays.equals(response.body(), Arrays.copyOfRange(video, 1000, 2000)), "바이트가 다르다");
                    String range = response.headers().firstValue("Content-Range").orElse("-");
                    check(range.equals("bytes 1000-1999/" + video.length), "Content-Range=" + range);
                }),
                step("08 미리 서명한 GET + Range bytes=N-(Android 이어받기) → 206", () -> {
                    int from = video.length - 4096;
                    HttpResponse<byte[]> response = get(storage.presignPlayback(presignedKey, 600), "bytes=" + from + "-");
                    check(response.statusCode() == 206, "status=" + response.statusCode());
                    check(Arrays.equals(response.body(), Arrays.copyOfRange(video, from, video.length)), "바이트가 다르다");
                }),
                step("09 downloadToPath(분석·코칭, 이미 있는 파일에 덮어쓰기) → 같은 바이트·head 와 같은 ETag", () -> {
                    StoredObjectMetadata meta = storage.downloadToPath(presignedKey, download);
                    check(Arrays.equals(Files.readAllBytes(download), video), "바이트가 다르다");
                    check(meta.etag() != null && meta.etag().equals(headETag[0]),
                            "내려받기 ETag 가 head 와 다르다(분석의 변경 검사가 실패한다): " + shape(meta.etag()));
                    check(meta.sizeBytes() == video.length, "size=" + meta.sizeBytes());
                }),
                step("10 upload(Path) 20MB(녹음·포스터·모자이크) → head·내려받기 일치", () -> {
                    storage.upload(fileKey, "audio/mp4", source);
                    StoredObjectMetadata meta = storage.head(fileKey);
                    check(meta != null && meta.sizeBytes() == audio.length, "head=" + (meta == null ? "null" : meta.sizeBytes()));
                    check("audio/mp4".equals(meta.contentType()), "contentType=" + meta.contentType());
                    StoredObjectMetadata downloaded = storage.downloadToPath(fileKey, download);
                    check(Arrays.equals(Files.readAllBytes(download), audio), "바이트가 다르다");
                    check(meta.etag().equals(downloaded.etag()), "head 와 내려받기 ETag 가 다르다");
                }),
                step("11 upload(Path) 객체를 미리 서명한 GET + Range 로 읽기 → 206", () -> {
                    HttpResponse<byte[]> response = get(storage.presignPlayback(fileKey, 600), "bytes=0-1023");
                    check(response.statusCode() == 206, "status=" + response.statusCode());
                    check(Arrays.equals(response.body(), Arrays.copyOf(audio, 1024)), "바이트가 다르다");
                }),
                step("12 upload(byte[])(고품질 목소리·블로그 이미지) → head·미리 서명한 GET 일치", () -> {
                    storage.upload(bytesKey, "image/jpeg", image);
                    StoredObjectMetadata meta = storage.head(bytesKey);
                    check(meta != null && meta.sizeBytes() == image.length, "head=" + (meta == null ? "null" : meta.sizeBytes()));
                    check("image/jpeg".equals(meta.contentType()), "contentType=" + meta.contentType());
                    HttpResponse<byte[]> response = get(storage.presignPlayback(bytesKey, 600), null);
                    check(response.statusCode() == 200 && Arrays.equals(response.body(), image), "status=" + response.statusCode());
                }),
                step("13 head(없는 키) → null", () -> check(storage.head(prefix + "missing") == null, "null 이 아니다")),
                step("14 만료된 미리 서명한 GET → 403", () -> {
                    String expiring = storage.presignPlayback(presignedKey, 1);
                    Thread.sleep(3000);
                    int status = get(expiring, null).statusCode();
                    check(status == 403, "status=" + status);
                }),
                step("15 delete(정리 장부) → 이후 head null, 미리 서명한 GET 404", () -> {
                    String playback = storage.presignPlayback(presignedKey, 600);
                    for (String key : List.of(presignedKey, fileKey, bytesKey)) {
                        storage.delete(key);
                        check(storage.head(key) == null, "지운 뒤에도 head 가 있다");
                    }
                    int status = get(playback, null).statusCode();
                    check(status == 404, "지운 객체 GET status=" + status);
                }),
                step("16 delete(없는 키) → 예외 없음(정리 장부 재시도가 성공으로 끝난다)",
                        () -> storage.delete(prefix + "missing")),
                step("17 정리: _probe/ 아래 이번 객체를 모두 지움", () -> {
                    List<String> left = new ArrayList<>();
                    for (String key : written) {
                        storage.delete(key);
                        if (storage.head(key) != null) {
                            left.add(key.substring(prefix.length()));
                        }
                    }
                    Files.deleteIfExists(download);
                    Files.deleteIfExists(source);
                    storage.close();
                    check(left.isEmpty(), "남은 객체 " + left.size() + "개");
                }));
    }

    private interface Step {
        void run() throws Exception;
    }

    /** 원래 예외는 붙이지 않는다 — 메시지·원인에 서명 주소나 응답 본문이 들어갈 수 있다. */
    private static DynamicTest step(String name, Step body) {
        return DynamicTest.dynamicTest(name, () -> {
            try {
                body.run();
            } catch (ProbeFailure failure) {
                throw new AssertionError(failure.getMessage(), null);
            } catch (AwsServiceException error) {
                throw new AssertionError(error.getClass().getSimpleName() + " status=" + error.statusCode()
                        + " code=" + (error.awsErrorDetails() == null ? "-" : error.awsErrorDetails().errorCode()), null);
            } catch (Throwable error) {
                StringBuilder chain = new StringBuilder(error.getClass().getName());
                for (Throwable cause = error.getCause(); cause != null && cause != cause.getCause(); cause = cause.getCause()) {
                    chain.append(" <- ").append(cause.getClass().getName());
                }
                throw new AssertionError(chain.toString(), null);
            }
        });
    }

    private static final class ProbeFailure extends Exception {
        ProbeFailure(String message) {
            super(message, null, false, false);
        }
    }

    private static void check(boolean condition, String detail) throws ProbeFailure {
        if (!condition) {
            throw new ProbeFailure(detail);
        }
    }

    private static int put(String url, String contentType, byte[] body) throws Exception {
        return HTTP.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(60))
                .header("Content-Type", contentType)
                .PUT(HttpRequest.BodyPublishers.ofByteArray(body)).build(), HttpResponse.BodyHandlers.discarding())
                .statusCode();
    }

    private static HttpResponse<byte[]> get(String url, String range) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(60)).GET();
        if (range != null) {
            request.header("Range", range);
        }
        return HTTP.send(request.build(), HttpResponse.BodyHandlers.ofByteArray());
    }

    private static String md5(byte[] body) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("MD5").digest(body));
    }

    /** ETag 값 대신 모양만 보인다(따옴표·길이·하이픈). */
    private static String shape(String etag) {
        if (etag == null) {
            return "null";
        }
        return "quoted=" + etag.startsWith("\"") + " length=" + etag.length() + " dash=" + etag.contains("-");
    }

    private static byte[] randomBytes(int size, long seed) {
        byte[] bytes = new byte[size];
        new Random(seed).nextBytes(bytes);
        return bytes;
    }
}
