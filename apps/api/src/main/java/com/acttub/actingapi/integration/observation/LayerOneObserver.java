package com.acttub.actingapi.integration.observation;

import java.nio.file.Path;
import java.util.UUID;

/**
 * 코칭 영상 1층 관찰(SOMA-815). 영상을 받아쓴 대사 덩어리마다 관찰 모델이 본 것을 적은 글을 돌려준다.
 *
 * <p>코치 지시문에 그대로 붙일 "## 1층 관찰" 칸이다. 대사가 없거나 관찰을 못 하면 빈 글을 돌려준다.
 * 오래 걸린다(영상 1~2분에 30초~2분). 부르는 쪽이 뒤에서 돌린다.
 */
public interface LayerOneObserver {
    String observe(Path video, String mimeType, String scene, UUID practiceSessionId, UUID userId);
}
