package com.acttub.actingapi.feature.coach.app;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Pro 「습관을 기억하는 코칭」(SOMA-900). 다른 장면으로 한 최근 연습에서 코치가 짚은 것·다음에 해 보기로 한 것을 Pro 코치에게 넘긴다.
 *
 * <p>무료 코치는 같은 묶음(이어서 하기)의 앞 회차만 안다. Pro 코치는 다른 장면의 지난 연습도 안다 — 회차를 넘어 반복되는 버릇을
 * 이번 영상에서 다시 보일 때 이어서 짚으려고.
 *
 * <p><b>10/13 교훈.</b> 지난 코치 진단을 배우의 사실로 넣었더니 새 진단이 그쪽으로 끌려갔다({@link PriorContext#withoutCoachGuesses()}).
 * 그래서 여기서는 (1) 배우가 노트에서 직접 본 제목·다음 테이크만 쓰고, (2) 배우가 아니라고 한 회차의 진단은 빼고 정정만 남기고,
 * (3) 「도움 안 됨」을 누른 노트는 빼고, (4) 이번 영상에서 같은 모습이 보일 때만 꺼내라고 지시한다. 근본 문제는 이번 영상에서 고른다.
 */
public interface CoachProMemory {
    /** 지난 연습 하나. 날짜·배우가 적은 상황·노트 제목(짚은 것)·다음 테이크·배우가 아니라고 한 것·노트 평가. */
    record Past(Instant at, String situation, String title, String nextTake, List<String> corrections, String rating) {}

    int LIMIT = 5;

    /** 이 배우가 이번 연습과 다른 묶음에서 최근에 마친 코칭 노트들(최신 먼저). */
    List<Past> recent(UUID userId, UUID practiceId, int limit);

    CoachProMemory NONE = (userId, practiceId, limit) -> List.of();

    String HEAD = """
            ## 지난 연습 기억 (Pro)
            이 배우가 다른 장면으로 했던 최근 연습에서 코치가 짚은 것과 다음 테이크로 정한 것이다. 짚은 것은 그때 코치의 관찰이지 이 배우에 대한 사실이 아니다.
            - 이번 영상에서 같은 모습이 실제로 보이고 들릴 때만, 그 순간의 대사를 가리키며 "지난 연습에서도 ~를 짚었는데"처럼 한 문장으로 잇는다. 이번 영상에서 안 보이면 꺼내지 않는다.
            - 지난번 다음 테이크로 정한 것을 이번에 해 본 게 보이면 그것을 알아봐 준다. 해 봤는지 영상만으로 모르겠으면 단정하지 말고 묻는다.
            - 근본 문제는 이번 영상에서 고른다. 지난 기억 때문에 같은 진단으로 끌려가지 않는다.
            - 「배우가 아니라고 한 것」은 다시 꺼내지 않는다.
            - 지난 기억은 이 대화에서 많아야 두 번 쓴다. 지난 장면의 대사·상황을 이번 장면 것처럼 말하지 않는다.
            """;

    DateTimeFormatter DAY = DateTimeFormatter.ofPattern("M/d").withZone(ZoneId.of("Asia/Seoul"));

    /** 코치 지시문 칸. 쓸 것이 없으면 빈 글이다. */
    static String block(List<Past> pasts) {
        if (pasts == null || pasts.isEmpty()) return "";
        List<String> lines = new ArrayList<>();
        for (Past past : pasts) {
            if (past == null || "not_helpful".equals(past.rating())) continue;
            boolean corrected = past.corrections() != null && !past.corrections().isEmpty();
            StringBuilder line = new StringBuilder("- ");
            line.append(past.at() == null ? "" : DAY.format(past.at()) + " ");
            String situation = clip(past.situation(), 40);
            if (!situation.isEmpty()) line.append("「").append(situation).append("」 ");
            List<String> parts = new ArrayList<>();
            String title = clip(past.title(), 60);
            if (!corrected && !title.isEmpty()) parts.add("짚은 것: " + title);
            String next = clip(past.nextTake(), 80);
            if (!corrected && !next.isEmpty()) parts.add("다음 테이크로 정한 것: " + next);
            if (corrected) {
                List<String> said = past.corrections().stream().map(text -> clip(text, 60)).filter(text -> !text.isEmpty()).limit(2).toList();
                if (!said.isEmpty()) parts.add("배우가 아니라고 한 것: " + String.join(" / ", said));
            }
            if (parts.isEmpty()) continue;
            line.append(String.join(" · ", parts));
            lines.add(line.toString());
        }
        if (lines.isEmpty()) return "";
        return HEAD + String.join("\n", lines) + "\n\n";
    }

    private static String clip(String text, int max) {
        if (text == null) return "";
        String flat = text.replaceAll("\\s+", " ").strip();
        // 예전 노트에는 다음 테이크 자리에 "없음"이 들어간 것이 있다(10/26 운영) — 제안이 아니다.
        if (flat.equals("없음") || flat.equals("없음.")) return "";
        return flat.length() <= max ? flat : flat.substring(0, max - 1) + "…";
    }
}
