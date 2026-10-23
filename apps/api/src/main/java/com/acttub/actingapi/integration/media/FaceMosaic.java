package com.acttub.actingapi.integration.media;

import java.nio.file.Path;

/**
 * 영상의 얼굴을 가린 사본을 만든다. 챌린지 참여작과 코칭 연습(얼굴 가리기)이 같은 {@link FaceMosaicRenderer} 를 쓴다.
 *
 * <p>가린 사본을 만들 수 없으면(만들 수 없는 기동·얼굴을 못 찾음) 부르는 쪽은 원본으로 돌아가지 않는다(fail-closed).
 */
public interface FaceMosaic {
    /** 만들 수 없는 기동(ffmpeg 없음). 부르는 쪽은 원본을 쓰지 않고 실패로 닫는다. */
    FaceMosaic NONE = new FaceMosaic() {
        @Override
        public boolean available() {
            return false;
        }

        @Override
        public Path render(Path source) {
            throw new IllegalStateException("face mosaic is unavailable");
        }
    };

    /** 가린 사본을 만들 수 있는 기동인가. */
    boolean available();

    /**
     * {@code source} 옆에 얼굴을 가린 mp4 를 만든다. 반환한 파일은 호출자가 지운다.
     *
     * @throws FaceMosaicRenderer.NoFaceFound 얼굴을 한 번도 찾지 못했다. 다시 해도 같다
     */
    Path render(Path source) throws Exception;
}
