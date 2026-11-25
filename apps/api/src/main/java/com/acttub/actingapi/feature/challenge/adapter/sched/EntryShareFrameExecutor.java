package com.acttub.actingapi.feature.challenge.adapter.sched;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * 공유 프레임 영상을 만드는 실행기 (challenge.entry 공유 프레임, SOMA-1156). 요청이 맡기고 바로 돌아간다. 모자이크
 * 실행기({@code EntryMosaicScheduler})처럼 스레드 하나라 ffmpeg 가 {@code FfmpegLock} 을 기다려도 요청·공용 스케줄러
 * 스레드를 붙잡지 않는다. 줄은 짧게 둔다 — 넘치면 맡기지 않고, 앱이 다시 요청할 때 다시 맡긴다.
 */
@Configuration(proxyBeanMethods = false)
class EntryShareFrameExecutor {
    static final int QUEUE = 8;

    @Bean("entryShareFrameExecutor")
    static ThreadPoolTaskExecutor entryShareFrameExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(1);
        executor.setQueueCapacity(QUEUE);
        executor.setThreadNamePrefix("entry-share-frame-");
        executor.setDaemon(true);
        return executor;
    }
}
