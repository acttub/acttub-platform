package com.acttub.actingapi.feature.reading.adapter;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.PronunciationReportRepository;
import com.acttub.actingapi.feature.reading.app.PronunciationSettings;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

/** 발음 보고서 켜는 값 읽기: 비면 아무도, 쉼표·공백을 견디고, 주소가 없으면 꺼진 것과 같다(SOMA-606). */
class PronunciationConfigurationTest {
    final PronunciationConfiguration configuration = new PronunciationConfiguration();

    @Test
    void 허용_사용자_목록을_읽는다() {
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        assertThat(PronunciationConfiguration.parseUsers(null)).isEmpty();
        assertThat(PronunciationConfiguration.parseUsers("  ")).isEmpty();
        assertThat(PronunciationConfiguration.parseUsers(" " + a + ", ," + b + " ")).containsExactlyInAnyOrder(a, b);
    }

    @Test
    void 켜는_값을_모아_설정을_만든다() {
        UUID user = UUID.randomUUID();
        PronunciationSettings on = configuration.pronunciationSettings(true, user.toString(), "http://pron:8000", 600, 3);
        assertThat(on.running()).isTrue();
        assertThat(on.allows(user)).isTrue();
        assertThat(on.allows(UUID.randomUUID())).isFalse();
        assertThat(on.lease()).isEqualTo(Duration.ofMinutes(10));
        assertThat(on.maxAttempts()).isEqualTo(3);

        PronunciationSettings noUrl = configuration.pronunciationSettings(true, user.toString(), " ", 600, 3);
        assertThat(noUrl.running()).isFalse();
        assertThat(noUrl.allows(user)).isFalse();
        assertThat(configuration.pronunciationSettings(false, user.toString(), "http://pron:8000", 600, 3).allows(user)).isFalse();
    }

    @Test
    void 일꾼과_조회_서비스를_조립한다() {
        PronunciationSettings settings = configuration.pronunciationSettings(false, "", "", 600, 3);
        PronunciationReportRepository reports = Mockito.mock(PronunciationReportRepository.class);
        var scorer = configuration.pronunciationScorer(settings, new ObjectMapper());
        assertThat(scorer).isNotNull();
        assertThat(configuration.pronunciationReportService(reports, settings, Clock.systemUTC())).isNotNull();
        assertThat(configuration.pronunciationWorker(reports, scorer, (key, path) -> { }, settings, Clock.systemUTC())).isNotNull();
    }
}
