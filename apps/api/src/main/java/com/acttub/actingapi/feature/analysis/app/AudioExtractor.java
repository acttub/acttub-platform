package com.acttub.actingapi.feature.analysis.app;

import java.nio.file.Path;

/**
 * 전사에 넣을 소리를 영상에서 뽑는다.
 *
 * <p><b>낸 것을 거두는 것도 이 포트의 일이다.</b> 종전에는 부르는 쪽이
 * {@code audioPath.getParent()} 를 지웠는데, 그것은 "추출물이 임시 디렉토리 안에 홀로 산다"는
 * 구현 사정을 부르는 쪽이 아는 형태였다 — 디렉토리를 쓰지 않는 추출기로 갈아끼우면 엉뚱한
 * 곳을 지운다. 자원을 준 쪽이 거둔다.
 */
public interface AudioExtractor {

    /** 소리만 뽑아 임시 파일로 낸다. 다 쓰면 {@link #discard} 로 돌려준다. */
    Path extract(Path videoPath, long maximumDurationMs);

    /** {@link #extract} 가 낸 것을, 거기 딸린 임시 자원까지 함께 거둔다. */
    void discard(Path audioPath);
}
