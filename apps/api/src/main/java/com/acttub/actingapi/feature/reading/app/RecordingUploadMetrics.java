package com.acttub.actingapi.feature.reading.app;

import java.time.Duration;
import java.util.EnumMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

import com.acttub.actingapi.feature.reading.domain.RecordingRules;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;

/**
 * 녹음 올리기 한 요청이 어느 구간에서 시간을 쓰는지 단계별로 남긴다 (reading.recording).
 *
 * <p>지표는 {@code acttub_reading_recording_upload_seconds} 하나이고 라벨은 {@code stage}·{@code conversion} 둘뿐이다.
 * 사용자·회차·요청을 알아볼 값은 라벨에 넣지 않는다. 시계열은 기동할 때 모두 만들어 두어 수가 고정이다.
 * {@code conversion} 은 올라온 파일이 m4a 가 아니어서 ffmpeg 변환을 타는지(transcoded) 건너뛰는지(skipped)다.
 *
 * <p>재는 일은 흐름을 바꾸지 않는다. 단계가 예외로 끝나도 쓴 시간은 남기고 예외는 그대로 나간다.
 */
public final class RecordingUploadMetrics {
    static final String NAME = "acttub.reading.recording.upload";
    // 운영 7일(2026-11-24) p50 0.39초·p99 5.67초·최대 99.8초. 1초·2초·5초를 가르고 DB 단계의 수 ms 도 보이게 한다.
    private static final Duration[] BUCKETS = {
        Duration.ofMillis(5), Duration.ofMillis(10), Duration.ofMillis(25), Duration.ofMillis(50),
        Duration.ofMillis(100), Duration.ofMillis(250), Duration.ofMillis(500), Duration.ofSeconds(1),
        Duration.ofSeconds(2), Duration.ofSeconds(5), Duration.ofSeconds(10), Duration.ofSeconds(30),
        Duration.ofSeconds(60), Duration.ofSeconds(120)
    };

    /** 요청 하나가 지나는 순서대로. 정리·다시 받아쓰기는 할 일이 있을 때만 남긴다. */
    public enum Stage {
        /** 컨테이너가 multipart 본문을 끝까지 읽어 파트로 나누기까지(기기에서 올라오는 시간 포함). */
        RECEIVE,
        /** 본문을 다 받은 뒤 컨트롤러에 들어오기까지: 핸들러 찾기와 동의 게이트(사용자·동의·프로필 조회). */
        GATE,
        /** 받은 파트를 서비스가 읽을 임시 파일로 옮기기. */
        TEMP_FILE,
        /** 잠그지 않는 사전 확인(회차·줄·같은 요청 id·지금 녹음). */
        PRECHECK,
        /** ffmpeg 로 m4a 바꾸기. conversion=transcoded 에만 있다. */
        TRANSCODE,
        /** 객체 저장소(S3)에 올리기. */
        STORAGE,
        /** 회차 행을 잠그고 녹음 행을 쓰는 저장 트랜잭션(커밋 포함). */
        STORE,
        /** 커밋 뒤 장부의 정리 시도(앞 객체 S3 지우기 포함). 대체·거절로 남은 객체가 있을 때만. */
        CLEANUP,
        /** 서버 다시 받아쓰기 큐에 넣기. 넣을 때만. */
        RETRANSCRIBE;

        String label() {
            return name().toLowerCase(Locale.ROOT);
        }
    }

    private final Map<Stage, Timer> transcoded = new EnumMap<>(Stage.class);
    private final Map<Stage, Timer> skipped = new EnumMap<>(Stage.class);

    public RecordingUploadMetrics(MeterRegistry registry) {
        for (Stage stage : Stage.values()) {
            transcoded.put(stage, timer(registry, stage, "transcoded"));
            if (stage != Stage.TRANSCODE) {
                skipped.put(stage, timer(registry, stage, "skipped"));
            }
        }
    }

    private static Timer timer(MeterRegistry registry, Stage stage, String conversion) {
        return Timer.builder(NAME)
                .description("Time spent in each stage of one reading recording upload")
                .tags("stage", stage.label(), "conversion", conversion)
                .serviceLevelObjectives(BUCKETS)
                .register(registry);
    }

    /** 서비스가 고르는 것과 같은 기준이다: m4a(AAC)가 아니면 변환한다. */
    public static boolean transcodes(String contentType) {
        return !RecordingRules.alreadyM4a(contentType);
    }

    /** {@code startedNanos}({@link System#nanoTime()})부터 지금까지를 남긴다. */
    public void recordSince(Stage stage, boolean transcodes, long startedNanos) {
        record(stage, transcodes, System.nanoTime() - startedNanos);
    }

    public void record(Stage stage, boolean transcodes, long nanos) {
        Timer timer = (transcodes ? transcoded : skipped).get(stage);
        if (timer != null && nanos >= 0) {
            timer.record(nanos, TimeUnit.NANOSECONDS);
        }
    }

    public <T> T time(Stage stage, boolean transcodes, Supplier<T> work) {
        long started = System.nanoTime();
        try {
            return work.get();
        } finally {
            recordSince(stage, transcodes, started);
        }
    }

    public void time(Stage stage, boolean transcodes, Runnable work) {
        long started = System.nanoTime();
        try {
            work.run();
        } finally {
            recordSince(stage, transcodes, started);
        }
    }
}
