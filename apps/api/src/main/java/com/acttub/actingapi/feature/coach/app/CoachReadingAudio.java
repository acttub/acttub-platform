package com.acttub.actingapi.feature.coach.app;

import java.nio.file.Path;
import java.util.UUID;

/**
 * 리딩 녹음으로 시작한 코칭 회차(SOMA-791)의 재료. 회차에 붙은 리딩 회차의 내 대사 녹음을 한 소리 파일로 잇고, 대본과 줄별 시간,
 * 서버가 잰 소리 단서를 글로 준다. 코치는 영상 대신 이 소리를 모델에 올린다.
 */
public interface CoachReadingAudio {
    CoachReadingAudio NONE = (userId, practiceId, withAudio) -> null;

    /**
     * @param withAudio 소리 파일까지 이을지. {@code false} 면 글과 열쇠만 준다({@code audio} null) — 올려 둔 파일을 다시 쓸 때다.
     * @return 이을 녹음이 없거나(리딩 회차가 지워졌거나 소리 든 줄이 모자람) 회차가 남의 것이면 {@code null}. 반환한 파일은 호출자가 지운다.
     */
    Prepared prepare(UUID userId, UUID practiceId, boolean withAudio);

    /**
     * @param audio 이은 소리 파일(16kHz 모노 WAV)
     * @param mimeType 올릴 때의 형식
     * @param sourceKey 같은 녹음이면 같은 값 — 올려 둔 파일을 다시 쓸지 가리는 열쇠다
     * @param material 모델에 보일 글: 대본(내 대사·상대 대사), 소리 파일 안 줄별 시간, 서버가 잰 소리 단서
     */
    record Prepared(Path audio, String mimeType, String sourceKey, String material) {
    }
}
