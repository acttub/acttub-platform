package com.acttub.actingapi.spike;

import java.time.Duration;
import java.util.function.Supplier;

/**
 * {@code summarizer.py:19-32} 의 {@code _wait_active} 대응.
 *
 * <p>Files API 업로드 직후 파일은 {@code PROCESSING} 이고, {@code ACTIVE} 가 되기 전에는
 * {@code generateContent} 에 쓸 수 없다. 원본은 폴링 + 타임아웃이며, 타임아웃 시
 * {@code FileActiveTimeout} 을 던진다. 압축 폴백으로 수백 MB 원본이 올라오면
 * 이 대기가 실제로 길어지므로 타임아웃 경로는 장식이 아니다.
 *
 * <p>상태 조회를 {@link Supplier} 로 받아 네트워크 없이 타임아웃 분기를 테스트할 수 있게 했다.
 */
final class FileActivationPoller {

    static final class FileActiveTimeoutException extends RuntimeException {
        FileActiveTimeoutException(String message) {
            super(message);
        }
    }

    private FileActivationPoller() {
    }

    /**
     * @param stateSupplier 매 폴링마다 현재 상태 문자열(PROCESSING/ACTIVE/FAILED)을 준다
     * @param nanoTime      단조 시계. 테스트에서 갈아끼운다
     */
    static String waitUntilActive(String initialState, Supplier<String> stateSupplier,
            Duration timeout, Duration pollInterval, Supplier<Long> nanoTime, Sleeper sleeper) {
        long deadline = nanoTime.get() + timeout.toNanos();
        String current = initialState;
        while ("PROCESSING".equals(current)) {
            if (nanoTime.get() >= deadline) {
                throw new FileActiveTimeoutException(
                        "file not ACTIVE within " + timeout.toSeconds() + "s");
            }
            sleeper.sleep(pollInterval);
            current = stateSupplier.get();
        }
        if (!"ACTIVE".equals(current)) {
            throw new FileActiveTimeoutException("file state=" + current);
        }
        return current;
    }

    @FunctionalInterface
    interface Sleeper {
        void sleep(Duration duration);

        static Sleeper real() {
            return duration -> {
                try {
                    Thread.sleep(duration.toMillis());
                } catch (InterruptedException exc) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("interrupted while polling", exc);
                }
            };
        }
    }
}
