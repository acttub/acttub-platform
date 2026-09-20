package com.acttub.actingapi.feature.reading.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.ScriptViews.ScriptListView;
import com.acttub.actingapi.feature.reading.app.ScriptViews.ScriptView;
import com.acttub.actingapi.feature.reading.domain.ScriptDraft;

/**
 * reading 이 저장소에 요구하는 것 — 대본 (reading.script).
 *
 * <p>없음을 {@code null} 로 알린다(ADR-018). "없는 것"과 "남의 것"을 가르지 않는다 — 모든 연산이 그 회원의
 * 것만 본다. 쓰기는 최종 저장 직전에 {@code users} 행을 잡고 계정이 활성인지 다시 본다(03-reading 「리딩
 * 자료의 이관·삭제·탈퇴」) — 이관·탈퇴가 먼저 끝났으면 옛 계정에 쓰지 않고 {@link OwnerNotActive} 다.
 */
public interface ScriptRepository {

    /**
     * 대본을 한 트랜잭션에서 만든다 — scripts 한 행, 배역, 줄. 같은 (user_id, request_id) 가 이미 있으면
     * <b>개수를 세기 전에</b> 그것으로 답한다: 지문이 같으면 먼저 만든 대본({@code created=false}), 다르면
     * {@link Outcome#FINGERPRINT_MISMATCH}. 개수가 {@code limit} 이상이면 {@link Outcome#OVER_LIMIT} 이고
     * 행이 남지 않는다.
     *
     * @throws OwnerNotActive 계정이 활성이 아니다 — 아무것도 쓰지 않았다
     */
    Creation create(UUID userId, UUID requestId, String fingerprint, ScriptDraft draft, int limit);

    /** @param scriptId 만들었거나 먼저 만들어 둔 대본. 거절이면 {@code null} */
    record Creation(UUID scriptId, boolean created, Outcome outcome) {
    }

    enum Outcome {
        CREATED,
        REPLAYED,
        FINGERPRINT_MISMATCH,
        OVER_LIMIT
    }

    /** 없으면 {@code null}. */
    ScriptView find(UUID userId, UUID scriptId);

    /**
     * 최근 고친 순. {@code query} 는 제목과 배역 이름에서 찾고 대사 본문은 찾지 않는다. 비어 있으면 전부다.
     * 머리의 수(전체·연습 중)는 검색과 무관하다.
     */
    ScriptListView list(UUID userId, String query);

    /**
     * 제목과 배역의 이름·목소리만 고친다. 줄은 불변이다. {@code null} 인 제목은 그대로 둔다.
     *
     * @return 고친 뒤의 이름 충돌 같은 규칙 위반이면 그 이유, 없으면 {@link UpdateOutcome#UPDATED}. 없는 대본이면
     *         {@code null}
     */
    UpdateOutcome update(UUID userId, UUID scriptId, String title, List<CharacterPatch> characters);

    /**
     * @param name {@code null} 이면 그대로 둔다. 앞뒤 공백은 이미 정리돼 있다
     * @param voicePresetSet {@code voicePreset} 을 바꾸려는가 — {@code null} 로 바꾸는 것("자동")과 그대로
     *        두는 것을 가른다
     */
    record CharacterPatch(UUID id, String name, boolean voicePresetSet, String voicePreset) {
    }

    enum UpdateOutcome {
        UPDATED,
        /** 이 대본에 없는 배역 id, 같은 id 둘, 비거나 겹치는 이름, 32자를 넘는 프리셋. */
        INVALID_CHARACTERS
    }

    /**
     * 배역·줄·회차·녹음·암기 상태와 함께 행째 지우고, 녹음 객체의 삭제를 <b>같은 트랜잭션에서</b> 정리 장부에
     * 올린다({@link ReadingRecordingCleanup}).
     *
     * @return 장부에 올린 객체 삭제. 부르는 쪽이 트랜잭션 밖에서 시도한다. 없는 대본이면 {@code null}
     */
    List<UUID> delete(UUID userId, UUID scriptId, Instant now);

    /**
     * 대본을 쓰는 트랜잭션이 {@code users} 행을 잡아 보니 계정이 활성이 아니었다 — 게이트를 지난 뒤에 다른
     * 기기의 탈퇴나 이관이 먼저 끝났다. 아무것도 쓰지 않았다.
     */
    final class OwnerNotActive extends RuntimeException {
        public OwnerNotActive() {
            super("the script owner is not an active account");
        }
    }
}
