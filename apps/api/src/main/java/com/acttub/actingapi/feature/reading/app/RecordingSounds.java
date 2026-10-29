package com.acttub.actingapi.feature.reading.app;

import java.util.List;
import java.util.Map;

import com.acttub.actingapi.feature.reading.domain.ReadingVoiceMaterial.Clip;
import com.acttub.actingapi.feature.reading.domain.RecordingSoundCues.Sound;

/** 리딩 녹음 코치에 보일 줄 녹음의 소리를 잰다(SOMA-791). 못 잰 줄은 빠진다. 실패는 던지지 않는다 — 코치는 질문만 한다. */
public interface RecordingSounds {
    RecordingSounds NONE = clips -> Map.of();

    /** @return 녹음 번호 → 잰 값 */
    Map<Integer, Sound> measure(List<Clip> clips);
}
