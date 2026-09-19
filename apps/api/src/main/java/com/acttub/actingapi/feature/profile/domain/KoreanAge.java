package com.acttub.actingapi.feature.profile.domain;

import java.time.LocalDate;
import java.time.Period;

/**
 * 만 나이. 생일이 <b>된 날부터</b> 한 살 는다 — 생일 전날과 당일이 한 살 차이다.
 *
 * <p>"오늘"은 부르는 쪽이 정한다. 서버는 한국 시간의 날짜로 센다 — 폰의 시간대와 무관하게 같은
 * 사람이 같은 나이여야 하고, 만 14세 판정이 자정 앞뒤로 갈리지 않아야 한다.
 */
public final class KoreanAge {

    /** 이 나이 미만은 법정대리인 동의가 필요해 1.0.0 은 받지 않는다. */
    public static final int MINIMUM = 14;

    private KoreanAge() {
    }

    public static int on(LocalDate birthDate, LocalDate today) {
        return Period.between(birthDate, today).getYears();
    }

    public static boolean underMinimum(LocalDate birthDate, LocalDate today) {
        return on(birthDate, today) < MINIMUM;
    }
}
