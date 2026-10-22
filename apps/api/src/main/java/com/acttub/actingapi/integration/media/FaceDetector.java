package com.acttub.actingapi.integration.media;

import java.util.List;

/**
 * 한 프레임에서 얼굴을 찾는다 (challenge.entry 얼굴 모자이크). 프레임은 bgr24 바이트(행 우선, 위에서 아래)다.
 * 한 인스턴스는 한 스레드만 쓴다.
 */
public interface FaceDetector extends AutoCloseable {

    /** 얼굴 상자들(픽셀, 프레임 좌표). 없으면 빈 목록. */
    List<Box> detect(byte[] bgr, int width, int height);

    @Override
    default void close() {
    }

    record Box(float x, float y, float width, float height) {
    }
}
