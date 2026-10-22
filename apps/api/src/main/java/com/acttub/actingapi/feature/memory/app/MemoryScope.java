package com.acttub.actingapi.feature.memory.app;

import com.acttub.actingapi.feature.memory.domain.ActorMemoryFields;
import com.acttub.actingapi.feature.memory.domain.MeaningfulMemoryValue;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * 기억 행 가운데 이번 회차의 코치가 읽을 것을 고른다 (SOMA-795).
 *
 * <p><b>장면 단위 칸(목표·다시 말하지 않을 것)은 같은 장면에서만 읽는다.</b> 장면은 {@code practices.root_id} 다 — 이어하기
 * 묶음이 같은 장면이고, 지난 회차 카드({@code PriorContext.sceneHistory})도 같은 기준으로 고른다. 한 대본의 인물 목표나
 * "아버지에게서…" 같은 정정이 다른 대본의 코칭에 섞여 들어가던 것을 이것으로 막는다(2026-10-22 운영 기억).
 *
 * <p>장면 없이 남은 장면 칸(scene_root_id NULL)은 <b>배우가 직접 쓴 것만</b> 어디서나 읽는다 — 배우가 자기 목표로 적은
 * 말이다. 모델이 쓴 장면 없는 값(옛 표의 목표 등)은 어느 장면의 것인지 몰라 읽지 않는다.
 */
public final class MemoryScope {

    /** 기억 한 행. {@code sceneRootId} 는 장면 단위 칸에서만 값이 있다. */
    public record Row(String field, String value, boolean writtenByActor, UUID sceneRootId) {
    }

    private MemoryScope() {
    }

    /**
     * 이번 회차({@code sceneRootId} 장면)의 코치가 읽는 칸. 같은 장면의 값이 배우가 장면 없이 쓴 값보다 먼저다.
     *
     * @param sceneRootId 이번 회차의 {@code root_id}. 모르면 {@code null} — 그때 장면 칸은 배우가 쓴 것만 남는다
     */
    public static Map<String, String> forScene(List<Row> rows, UUID sceneRootId) {
        Map<String, String> scene = new LinkedHashMap<>();
        Map<String, String> general = new LinkedHashMap<>();
        for (Row row : rows) {
            if (row.value() == null || row.value().isBlank()) continue;
            // 이미 저장된 뜻 없는 모델 값("…지점을 골랐다")도 읽지 않는다 — 코치에게도, 다음 갱신의 입력에도 가지 않는다.
            // 다시 말하지 않을 것은 코드가 배우 원문으로 쓰고, 맞춤 코칭은 따로 검사한다.
            if (!row.writtenByActor() && !"avoid".equals(row.field())
                    && !ActorMemoryFields.COACHING_PROFILE.equals(row.field())
                    && MeaningfulMemoryValue.problem(row.field(), row.value()).isPresent()) continue;
            if (!ActorMemoryFields.sceneScoped(row.field())) {
                if (row.sceneRootId() == null) general.putIfAbsent(row.field(), row.value());
                continue;
            }
            if (row.sceneRootId() != null) {
                if (Objects.equals(row.sceneRootId(), sceneRootId)) scene.putIfAbsent(row.field(), row.value());
            } else if (row.writtenByActor()) {
                general.putIfAbsent(row.field(), row.value());
            }
        }
        Map<String, String> kept = new LinkedHashMap<>();
        for (String field : ActorMemoryFields.NAMES) {
            String value = scene.containsKey(field) ? scene.get(field) : general.get(field);
            if (value != null) kept.put(field, value);
        }
        // 칸 목록에 없는 이름(성별·나이 같은 옛 칸)은 들어온 그대로 뒤에 둔다 — 부르는 쪽이 거른다.
        general.forEach(kept::putIfAbsent);
        return kept;
    }
}
