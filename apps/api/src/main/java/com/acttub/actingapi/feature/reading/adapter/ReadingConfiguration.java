package com.acttub.actingapi.feature.reading.adapter;

import java.time.Clock;

import com.acttub.actingapi.feature.reading.app.ReadingRecordingCleanup;
import com.acttub.actingapi.feature.reading.app.RecordingPlayback;
import com.acttub.actingapi.feature.reading.app.RecordingRepository;
import com.acttub.actingapi.feature.reading.app.RecordingService;
import com.acttub.actingapi.feature.reading.app.RecordingStorage;
import com.acttub.actingapi.feature.reading.app.ScriptRepository;
import com.acttub.actingapi.feature.reading.app.ScriptService;
import com.acttub.actingapi.feature.reading.app.SessionRepository;
import com.acttub.actingapi.feature.reading.app.SessionService;
import com.acttub.actingapi.integration.media.AudioTranscoder;
import com.acttub.actingapi.platform.web.CanonicalJson;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 리딩 서비스의 조립. 정리 장부는 장부의 주인인 {@code profile} 이 구현한 포트로 받는다. 음성 변환기는 영상 파이프라인과
 * 같은 ffmpeg 실행이며 테스트가 다른 실행기를 끼울 수 있게 빈으로 둔다.
 */
@Configuration
class ReadingConfiguration {

    @Bean
    ScriptService scriptService(
            ScriptRepository scripts, ReadingRecordingCleanup cleanup, CanonicalJson canonical, Clock clock) {
        return new ScriptService(scripts, cleanup, canonical, clock);
    }

    @Bean
    SessionService sessionService(
            SessionRepository sessions, ReadingRecordingCleanup cleanup, RecordingPlayback playback, Clock clock) {
        return new SessionService(sessions, cleanup, playback, clock);
    }

    @Bean
    RecordingPlayback recordingPlayback(RecordingStorage storage, Clock clock) {
        return new RecordingPlayback(storage, clock);
    }

    @Bean
    @ConditionalOnMissingBean
    AudioTranscoder audioTranscoder() {
        return new AudioTranscoder();
    }

    @Bean
    RecordingService recordingService(
            RecordingRepository recordings,
            RecordingStorage storage,
            AudioTranscoder transcoder,
            RecordingPlayback playback,
            ReadingRecordingCleanup cleanup,
            Clock clock) {
        return new RecordingService(recordings, storage, transcoder, playback, cleanup, clock);
    }
}
