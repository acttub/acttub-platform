package com.acttub.actingapi.feature.coach.app;

import java.util.List;

/**
 * 배우가 직접 저장한 <b>완성된</b> 프로필 — 코치가 모델에 그대로 넘기는 모양이다.
 *
 * <p>값은 전부 사람이 읽는 표시말이다(성별 "여성", 경력 "1–3년"). 저장 값을 표시말로 푸는 일은 그
 * 어휘의 주인인 {@code profile} 이 한다. 나이는 생년월일이 아니라 <b>만 나이</b>로 온다 — 제공자가
 * 한국 시간의 오늘로 센다. 생년월일은 코치에 넘어오지 않는다.
 *
 * <p>{@link PriorContext} 와 섞지 않는다. 기억은 지난 연습에서 코치가 정리한 참고 사항이고, 이것은
 * 배우가 지금 저장해 둔 값이다. 둘이 다르면 이쪽이 이긴다.
 *
 * @param directions 추구하는 방향. 하나 이상이다
 */
public record ActorProfile(
        String name,
        String gender,
        int age,
        List<String> directions,
        String experience,
        String goal) {

    public ActorProfile {
        directions = List.copyOf(directions);
    }
}
