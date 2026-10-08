package com.acttub.actingapi.feature.coach.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.regex.Pattern;

import org.junit.jupiter.api.Test;

class CoachDisplayTextTest {
    // 모바일 앱 splitCoachQuestion 의 자르는 자리(JS /(?<=[.!?。])\s+/). JS 의 \s 처럼 유니코드 공백을 모두 본다.
    private static final Pattern APP_SPLIT = Pattern.compile("(?<=[.!?。])\\s+", Pattern.UNICODE_CHARACTER_CLASS);

    @Test void aCoachQuestionNoLongerSplitsIntoHintAndQuestionButLooksTheSame() {
        String coach = "\"됐어\"에서 고개를 돌려요.\n상대가 물러나길 바랄 수도 있어요! 평소에도 그런 편이에요?";
        assertThat(APP_SPLIT.split(coach.strip())).hasSize(3);
        String shown = CoachDisplayText.keepWhole("coach", coach);
        assertThat(APP_SPLIT.split(shown.strip())).as("앱이 나누지 않는다").hasSize(1);
        assertThat(shown.replace(CoachDisplayText.INVISIBLE, "")).as("보이는 글자·띄어쓰기·줄바꿈은 같다").isEqualTo(coach);
    }

    @Test void onlyCoachMessagesEndingWithAQuestionMarkChange() {
        String closing = "오늘은 여기까지 해요. 새 테이크를 올리면 이어서 해요.";
        assertThat(CoachDisplayText.keepWhole("coach", closing)).isEqualTo(closing);
        assertThat(CoachDisplayText.keepWhole("actor", "몰라요. 어떻게 해요?")).isEqualTo("몰라요. 어떻게 해요?");
        assertThat(CoachDisplayText.keepWhole("ai", "그랬군요. 왜요?")).isEqualTo("그랬군요.\u200B 왜요?");
        assertThat(CoachDisplayText.keepWhole("coach", null)).isNull();
    }
}
