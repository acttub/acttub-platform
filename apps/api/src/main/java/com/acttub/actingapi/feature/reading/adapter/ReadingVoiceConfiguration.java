package com.acttub.actingapi.feature.reading.adapter;

import com.acttub.actingapi.feature.reading.adapter.pron.HttpRecordingSounds;
import com.acttub.actingapi.feature.reading.adapter.voice.ReadingVoiceCoaching;
import com.acttub.actingapi.feature.reading.app.ReadingVoiceMaterials;
import com.acttub.actingapi.feature.reading.app.RecordingSounds;
import com.acttub.actingapi.integration.media.AudioJoiner;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 리딩 녹음 코칭(reading.voice-coaching, SOMA-791). {@code ACTTUB_READING_VOICE_COACHING_ENABLED=true}(값이 없으면 dev 만) 일 때만 시작 확인·코치 재료·
 * 리딩 완료 화면 카드 경로가 생긴다. 꺼져 있으면 카드 확인은 404, 코칭 시작은 404 session_not_found 다.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnExpression(ReadingVoiceConfiguration.ENABLED)
public class ReadingVoiceConfiguration {

    public static final String SWITCH = "ACTTUB_READING_VOICE_COACHING_ENABLED";
    /** 값이 true 면 켠다. 값을 주지 않으면 dev 에서만 켜지고 운영은 꺼진다 — 운영은 사용자 승인 뒤 운영 env 로 켠다. */
    public static final String ENABLED = "'${" + SWITCH + ":}' == 'true' or ('${" + SWITCH + ":}' == ''"
            + " and '${SITE_URL:}' == 'https://dev.acttub.com')";

    @Bean
    ReadingVoiceCoaching readingVoiceCoaching(
            ReadingVoiceMaterials materials, ObjectProvider<ObjectStorage> storage, RecordingSounds sounds) {
        return new ReadingVoiceCoaching(materials, storage::getObject, sounds, new AudioJoiner());
    }

    /** 소리 재기는 발음 채점 서비스(apps/pron)의 {@code /measure} 를 쓴다. 주소가 없으면 재지 않고 코치는 대본으로만 묻는다. */
    @Bean
    RecordingSounds recordingSounds(
            @Value("${PRON_SCORER_URL:}") String scorerUrl, ObjectProvider<ObjectStorage> storage, ObjectMapper mapper) {
        if (scorerUrl == null || scorerUrl.isBlank()) {
            return RecordingSounds.NONE;
        }
        return new HttpRecordingSounds(scorerUrl, storage::getObject, mapper);
    }
}
