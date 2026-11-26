package com.acttub.actingapi.feature.reading.app;

import java.util.List;
import java.util.UUID;

/**
 * 한 사람이 최근 만지거나 올린 대본의 글을 다른 기능이 읽는 자리 (ADR-040). 알림이 잠금 화면에 낼 문구에서 대본의 말을 지우려고
 * 쓴다.
 */
public interface RecentScriptTexts {

    /** 대본 제목, 인물 이름, 대사 줄. 대본이 없으면 셋 다 비어 있다. */
    record Texts(List<String> titles, List<String> characterNames, List<String> lines) {
    }

    /**
     * @param scriptLimit 최근 고친 순으로 볼 대본 수
     * @param lineLimit 모을 대사 줄 수(여섯 자 이상인 줄만)
     */
    Texts of(UUID userId, int scriptLimit, int lineLimit);
}
