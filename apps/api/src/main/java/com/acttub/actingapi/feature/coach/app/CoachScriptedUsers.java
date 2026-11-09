package com.acttub.actingapi.feature.coach.app;

import java.util.Set;
import java.util.UUID;

/** 정해진 코칭 대본을 받을 계정인지 가린다(발표 시연). 이메일로 고른다. */
public interface CoachScriptedUsers {

    /** 아무도 대상이 아니다. */
    CoachScriptedUsers NONE = (userId, emails) -> false;

    /** {@code emails} 는 소문자로 다듬은 값이다. */
    boolean contains(UUID userId, Set<String> emails);
}
