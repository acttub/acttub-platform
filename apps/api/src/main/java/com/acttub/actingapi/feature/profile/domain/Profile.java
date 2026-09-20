package com.acttub.actingapi.feature.profile.domain;

import java.time.LocalDate;
import java.util.List;

/**
 * 가입 게이트에서 받는 여섯 항목과, 설정에서만 받는 사진·소개. {@code user_profiles} 와
 * {@code user_profile_directions} 를 함께 옮겨 담는다.
 *
 * <p>값 목록(성별·방향·경력·목표)을 열거형이 아니라 문자열로 들고 있다 — 그 열거형들은
 * {@code jakarta.persistence.Converter} 를 끌고 있고, 값은 그대로 응답에 실려 나간다.
 *
 * <p>여섯 항목이 전부 비어 있을 수 있다. 1.0.0 이전 회원은 옛 닉네임만 {@link #name} 에 들고 온다.
 *
 * @param photoKey 저장소의 객체 키. 응답에 실을 주소로 바꾸는 일은 서비스가 한다
 */
public record Profile(
        String name,
        String gender,
        LocalDate birthDate,
        List<String> directions,
        String experience,
        String goal,
        String photoKey,
        String bio) {

    public Profile {
        directions = List.copyOf(directions);
    }

    /** 필수 여섯 항목이 다 찼는가. 게이트가 이것을 본다. 사진과 소개는 선택이라 세지 않는다. */
    public boolean complete() {
        return name != null
                && gender != null
                && birthDate != null
                && !directions.isEmpty()
                && experience != null
                && goal != null;
    }
}
