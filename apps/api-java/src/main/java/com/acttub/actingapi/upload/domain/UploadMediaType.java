package com.acttub.actingapi.upload.domain;

import java.util.Locale;

/**
 * 업로드가 받는 미디어 타입. 정규화·판정과 오브젝트 키의 확장자 규칙을 함께 가진다.
 *
 * <p>거르는 일(415 로 옮기는 것)은 여기가 아니라 서비스가 한다 — 이 타입은 "무엇인가"만 답한다.
 */
public record UploadMediaType(String value) {

    /** 앞뒤 공백을 떼고 소문자로 맞춘다. 이 정규화된 값이 그대로 저장된다. */
    public static UploadMediaType of(String raw) {
        return new UploadMediaType(raw.strip().toLowerCase(Locale.ROOT));
    }

    public boolean video() {
        return value.startsWith("video/");
    }

    /**
     * 오브젝트 키 끝에 붙는 확장자.
     *
     * <p>아는 셋은 통상의 확장자로 옮기고, 나머지는 서브타입에서 <b>영숫자만</b> 12자까지 남긴다.
     * 파라미터({@code ;codecs=...})와 경로를 흔들 수 있는 글자가 키에 섞이지 않게 하려는 것이며,
     * 남는 것이 없으면 {@code .video} 로 떨어진다.
     */
    public String objectSuffix() {
        String subtype = value.split("/", 2)[1].split(";", 2)[0].toLowerCase(Locale.ROOT);
        return switch (subtype) {
            case "mp4" -> ".mp4";
            case "quicktime" -> ".mov";
            case "webm" -> ".webm";
            default -> {
                String safe = subtype.codePoints()
                        .filter(Character::isLetterOrDigit)
                        .limit(12)
                        .collect(StringBuilder::new, StringBuilder::appendCodePoint, StringBuilder::append)
                        .toString();
                yield safe.isEmpty() ? ".video" : "." + safe;
            }
        };
    }
}
