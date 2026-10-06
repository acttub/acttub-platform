package com.acttub.actingapi.feature.reading.domain;

import java.time.Duration;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/**
 * 대본 원본 파일의 규칙 (reading.script 「원본 파일」). 기기가 S3 에 직접 올리고 서버가 받아 글자를 뽑는다.
 */
public final class ScriptFileRules {

    /** 파일 한도. 옛 기기 한도(20,000,000)와 같이 10진으로 센다 — iOS 가 파일 크기를 10진으로 보인다. */
    public static final long FILE_MAX_BYTES = 50_000_000L;

    /** 올릴 자리를 내주는 확장자. 내용은 읽을 때 파일 머리로 다시 가른다. */
    public static final Set<String> EXTENSIONS = Set.of("txt", "docx", "pdf", "hwp", "hwpx");

    /** 서명한 올리기 주소의 수명. */
    public static final Duration UPLOAD_TTL = Duration.ofMinutes(15);

    /** 어느 대본에도 연결되지 않은 원본은 이만큼 지나면 지운다. */
    public static final Duration UNLINKED_TTL = Duration.ofDays(1);

    /** 형식과 무관하게 한 가지로 올린다 — 기기마다 hwp 의 MIME 이 제각각이다. */
    public static final String CONTENT_TYPE = "application/octet-stream";

    private ScriptFileRules() {
    }

    public static boolean accepts(String fileName) {
        int dot = fileName.lastIndexOf('.');
        return dot >= 0 && EXTENSIONS.contains(fileName.substring(dot + 1).strip().toLowerCase(Locale.ROOT));
    }

    public static String objectKey(UUID userId, UUID uploadId) {
        return "reading-source/" + userId + "/" + uploadId;
    }
}
