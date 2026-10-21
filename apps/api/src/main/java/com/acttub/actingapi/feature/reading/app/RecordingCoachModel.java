package com.acttub.actingapi.feature.reading.app;

import java.util.List;

import com.acttub.actingapi.feature.reading.domain.RecordingCoachMaterial.Clip;

/**
 * 리딩 녹음 코치의 모델 — 대본 글과 줄별 녹음을 함께 보이고 한 차례의 답을 받는다(reading.recording-coach, 실험).
 *
 * <p>녹음을 저장소에서 받아 모델에 올리는 일은 구현이 맡는다. 실패는 예외로 던진다.
 */
public interface RecordingCoachModel {

    /**
     * @param instruction 시스템 지시문
     * @param script 대본을 펼친 글. 첫 사용자 차례의 맨 앞에 들어가고 그 뒤에 녹음이 이름표와 함께 붙는다
     * @param clips 보일 녹음
     * @param turns 사용자부터 번갈아 오는 차례. 첫 차례는 대본·녹음 뒤에 이어 붙는다
     */
    Reply reply(String instruction, String script, List<Clip> clips, List<Turn> turns);

    /** @param coach {@code true} 면 모델(코치) 차례, 아니면 사용자 차례 */
    record Turn(boolean coach, String text) {
    }

    record Reply(String text, String model) {
    }
}
