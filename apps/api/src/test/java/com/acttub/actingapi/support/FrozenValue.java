package com.acttub.actingapi.support;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * {@code src/test/resources/frozen/} 의 기대값을 읽는다.
 *
 * <p>여기 있는 것은 <b>파이썬이 사라지기 직전에 파이썬에서 뽑은 값</b>이다({@code SOMA-403}
 * 5단계). 그전까지는 프롬프트·모델 필드·토큰을 대조할 상대가 실행 중인 파이썬이었고, 그래서
 * 기대값을 커밋하지 않았다 — fixture 와 자바 상수가 <b>둘 다 낡아도 초록</b>이 되기 때문이다.
 *
 * <p>🔁 <b>그 함정이 이제 성립하지 않는다.</b> 정본이 자바로 넘어왔으므로 "자바가 무엇을
 * 내는가" 가 곧 정답이고, 커밋된 값은 <b>자기참조가 아니라 회귀 검사</b>다 — 스키마 정본이
 * Flyway 로 넘어갔을 때 {@link SchemaFingerprint} 가 같은 이유로 fixture 기준이 된 것과 같다.
 * 잡으려는 것은 "정본과 어긋났는가" 가 아니라 <b>"의도 없이 바뀌었는가"</b> 다. 공백 하나가
 * 달라져도 같은 영상에서 다른 관찰이 나오는데, 그 차이는 어떤 스키마 검증으로도 잡히지 않는다.
 *
 * <p>⚠ <b>기대값을 바꿔야 한다면 이 파일들을 손으로 고치고 그 diff 를 리뷰에 남긴다.</b>
 * 자동 재생성 경로를 두지 않는 이유가 그것이다 — 다시 떠서 초록을 받아 들고 가면 검사가
 * 무력해진다({@code OpenApiSnapshotIT} 의 갱신 모드가 일부러 실패로 끝나는 것과 같은 이유).
 */
public final class FrozenValue {

    private FrozenValue() {
    }

    /** {@code frozen/} 아래의 파일을 UTF-8 문자열로 읽는다. 없거나 비어 있으면 실패한다. */
    public static String of(String name) {
        try (InputStream in = FrozenValue.class.getResourceAsStream("/frozen/" + name)) {
            if (in == null) {
                throw new IllegalStateException(
                        "frozen fixture 가 클래스패스에 없다: frozen/" + name);
            }
            String value = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            if (value.isEmpty()) {
                // 빈 기대값은 어떤 대조든 무의미하게 만든다 — 조용히 통과시키지 않는다.
                throw new IllegalStateException("frozen fixture 가 비어 있다: frozen/" + name);
            }
            return value;
        } catch (IOException exception) {
            throw new IllegalStateException("frozen fixture 를 읽지 못했다: frozen/" + name, exception);
        }
    }

    /** 줄 단위 기대값. 파일은 개행으로만 이어져 있고 마지막 줄에 개행이 없다. */
    public static java.util.List<String> linesOf(String name) {
        return of(name).lines().toList();
    }
}
