package com.acttub.actingapi.feature.profile.domain;

import java.time.LocalDate;

/**
 * 탈퇴한 사람의 생년월일을 뭉갠 5세 단위 연령대. 값은 구간의 아래 끝이다 — 25 는 만 25~29세.
 *
 * <p>원래 값은 지우고 이것만 남긴다. 통계·연구에는 구간이면 충분하고, 생년월일은 다른 값과 합치면
 * 사람을 알아보게 한다 (account.withdraw).
 */
public final class AgeBand {
    private static final int WIDTH = 5;

    private AgeBand() {
    }

    public static int of(LocalDate birthDate, LocalDate today) {
        int age = Math.max(0, KoreanAge.on(birthDate, today));
        return age - age % WIDTH;
    }
}
