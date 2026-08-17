package com.acttub.actingapi.feature.memory.app;

import java.util.List;
import java.util.UUID;

/**
 * 기억 갱신 잡이 읽는 연습 하나치 재료 (`store.py:get_memory_update_material`).
 *
 * <p><b>배우가 한 말만 담는다</b> — 코치가 한 말까지 넣으면 코치가 제안한 표현이 배우 본인의
 * 말로 굳어 기억에 남는다.
 */
public record MemoryUpdateMaterial(
        UUID userId,
        UUID practiceSessionId,
        String goal,
        String blockageKind,
        String subBranch,
        String blockageDetail,
        List<String> transcripts,
        List<String> actorMessages) {
}
