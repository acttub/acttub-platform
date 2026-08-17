package com.acttub.actingapi.integration.media;

import java.util.concurrent.Callable;
import java.util.concurrent.locks.ReentrantLock;

/** 압축과 섹션 D 음성 추출이 공유하는 단일 ffmpeg 실행 락. */
public final class FfmpegLock {

    private static final ReentrantLock LOCK = new ReentrantLock();

    private FfmpegLock() {
    }

    public static <T> T run(Callable<T> operation) throws Exception {
        LOCK.lock();
        try {
            return operation.call();
        } finally {
            LOCK.unlock();
        }
    }
}
