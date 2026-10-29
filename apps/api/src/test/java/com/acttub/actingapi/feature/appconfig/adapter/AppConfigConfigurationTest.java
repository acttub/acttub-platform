package com.acttub.actingapi.feature.appconfig.adapter;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import com.acttub.actingapi.feature.appconfig.app.AppConfig;
import com.acttub.actingapi.feature.challenge.domain.ChallengeRules;
import com.acttub.actingapi.feature.reading.domain.CocreateRules;
import com.acttub.actingapi.feature.reading.domain.LineMatch;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** app.config(SOMA-939) — 기본 파일, 덮을 파일, 잘못된 칸의 기본값 돌림, 서버 규칙과 같은 값. */
class AppConfigConfigurationTest {

    @TempDir Path dir;

    private AppConfig load(String file) throws Exception {
        return new AppConfigConfiguration().appConfig(file);
    }

    @Test
    void 기본값은_앱에_들어_있던_값과_같다() throws Exception {
        AppConfig c = load("");
        assertThat(c.rating()).isEqualTo(new AppConfig.Rating(2, 2, 7, 3));
        assertThat(c.reading()).isEqualTo(new AppConfig.Reading(0.015, 1800, 400, 60000, 1300, 0.9, 0.72, 0.3, 0.8, 3));
        assertThat(c.cocreate().emotions()).containsExactly("서운함", "설렘", "분노", "슬픔", "긴장", "담담함");
        assertThat(c.cocreate().situations()).containsExactly("오랜만의 재회", "이별", "오디션 직전", "가족 다툼", "고백", "사과");
        assertThat(c.homeTips().get("ko")).hasSize(7).first().isEqualTo("대사 전에 숨을 한 번 쉬면, 말보다 시선이 먼저 움직여요.");
        assertThat(c.homeTips().get("en")).hasSize(7);
        assertThat(c.challenge()).isEqualTo(new AppConfig.Challenge(3, 60, List.of(7, 14)));
    }

    @Test
    void 서버가_막는_규칙은_각_도메인_규칙과_같은_값이다() throws Exception {
        AppConfig c = load("");
        assertThat(c.reading().monologuePass()).isEqualTo(LineMatch.PASS_THRESHOLD);
        assertThat(c.challenge().entryMaxSeconds() * 1000).isEqualTo(ChallengeRules.ENTRY_VIDEO_MAX_MS);
        assertThat(c.challenge().durationsDays()).allMatch(ChallengeRules::duration);
        assertThat(ChallengeRules.duration(7) && ChallengeRules.duration(14) && !ChallengeRules.duration(30)).isTrue();
        assertThat(AppConfigConfiguration.RULES.allowedEmotions()).containsExactlyInAnyOrderElementsOf(CocreateRules.EMOTIONS);
    }

    @Test
    void 덮을_파일은_칸마다_덮고_잘못된_칸은_기본값으로_돌린다() throws Exception {
        Path file = dir.resolve("app-config.json");
        Files.writeString(file, """
                {
                  "rating": { "coach_every": 5 },
                  "reading": { "silence_ms": -1, "advance_coverage": 0.8, "monologue_pass": 0.1 },
                  "cocreate": { "emotions": ["설렘", "없는 감정"], "situations": ["  ", "첫 만남"] },
                  "home_tips": { "ko": ["새 팁"] },
                  "challenge": { "entry_min_seconds": 5, "entry_max_seconds": 999, "durations_days": [30] }
                }
                """);
        AppConfig c = load(file.toString());
        assertThat(c.rating()).isEqualTo(new AppConfig.Rating(5, 2, 7, 3));
        assertThat(c.reading().silenceMs()).as("음수는 기본값").isEqualTo(1800);
        assertThat(c.reading().advanceCoverage()).isEqualTo(0.8);
        assertThat(c.reading().monologuePass()).as("서버 판정선은 파일로 못 바꾼다").isEqualTo(0.72);
        assertThat(c.cocreate().emotions()).as("서버가 받지 않는 감정은 뺀다").containsExactly("설렘");
        assertThat(c.cocreate().situations()).containsExactly("첫 만남");
        assertThat(c.homeTips().get("ko")).containsExactly("새 팁");
        assertThat(c.homeTips().get("en")).hasSize(7);
        assertThat(c.challenge()).as("최대 길이·기간은 서버 규칙").isEqualTo(new AppConfig.Challenge(5, 60, List.of(7, 14)));
    }

    @Test
    void 덮을_파일을_못_읽거나_모양이_틀리면_기본값으로_선다() throws Exception {
        AppConfig defaults = load("");
        assertThat(load(dir.resolve("없는 파일.json").toString())).isEqualTo(defaults);
        Path broken = dir.resolve("broken.json");
        Files.writeString(broken, "{ \"rating\": { \"coach_every\": \"많이\" ");
        assertThat(load(broken.toString())).isEqualTo(defaults);
        Path wrongType = dir.resolve("wrong.json");
        Files.writeString(wrongType, "{ \"rating\": { \"coach_every\": \"많이\" } }");
        assertThat(load(wrongType.toString())).isEqualTo(defaults);
    }
}
