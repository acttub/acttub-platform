package com.acttub.actingapi.feature.memory.app;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 맞춤 코칭({@code coaching_profile})을 쓰는 재료 — 한 배우의 최근 대화들 (SOMA-795).
 *
 * <p>기억 칸 재료({@link MemoryUpdateMaterial})와 달리 <b>코치가 한 말도 담는다</b>. 어떤 말에서 배우가 얻었고 어떤 말에
 * 납득하지 못했는지는 코치 말과 배우 답을 같이 봐야 알 수 있다. 대신 결과물에는 배우에 대한 진단을 쓰지 않고, 코치가 쓸
 * 말의 모양만 남긴다({@link CoachingProfileWriter}).
 *
 * @param conversations 최근 것이 앞이다. 부르는 쪽이 개수와 길이를 이미 줄여 넣는다
 * @param actorMemory 배우 단위 칸(말투·바라는 것)
 * @param sceneTexts 장면 내용(목표·상황·인물). 결과물에 장면 내용이 새지 않았는지 보는 데만 쓰고 모델에 넘기지 않는다
 */
public record ProfileMaterial(
        UUID userId,
        List<Conversation> conversations,
        Map<String, String> actorMemory,
        String previousProfile,
        List<String> sceneTexts) {

    public ProfileMaterial {
        conversations = List.copyOf(conversations);
        actorMemory = Map.copyOf(actorMemory);
        sceneTexts = sceneTexts == null ? List.of() : List.copyOf(sceneTexts);
    }

    /**
     * 대화 하나.
     *
     * @param closeReason {@code user_ended}(배우가 끝냄)·{@code exhausted}(코치가 정리)·열린 채면 {@code null}
     * @param rating 코칭 노트 평가({@code helpful}·{@code not_helpful}), 없으면 {@code null}
     * @param ratingComment 평가에 붙인 한 줄
     * @param corrections 배우가 아니라고 한 것("주제: \"원문\"")
     */
    public record Conversation(
            String day,
            String closeReason,
            int actorReplies,
            List<Turn> turns,
            String rating,
            String ratingComment,
            List<String> corrections) {

        public Conversation {
            turns = List.copyOf(turns);
            corrections = corrections == null ? List.of() : List.copyOf(corrections);
        }
    }

    /** {@code role} 은 {@code ai}(코치) 또는 {@code actor}. 배우 말에는 대화 중 붙인 분류("(정정) …")가 앞에 있을 수 있다. */
    public record Turn(String role, String text) {
    }
}
