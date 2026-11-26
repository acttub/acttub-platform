package com.acttub.actingapi.feature.reading.app;

import java.time.Duration;
import java.util.EnumMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

import com.acttub.actingapi.feature.reading.app.PronunciationScorer.ServerTime;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;

/**
 * 발음 보고서 채점이 어디서 시간을 쓰는지 남긴다(reading.pronunciation). 긴 대본은 줄당 약 10초가 걸리는데 녹음 내려받기·
 * 채점 요청·채점 서비스 안의 계산 가운데 어디서 드는지 가르려고 잰다.
 *
 * <p>지표는 둘이고 라벨은 {@code stage} 하나다. 사용자·회차·보고서를 알아볼 값은 라벨에 넣지 않는다. 시계열은 기동할 때 모두
 * 만들어 두어 수가 고정이다.
 * <ul>
 *   <li>{@code acttub_reading_pronunciation_line_seconds} — 채점 서비스에 보낸 줄 하나. {@code download}·{@code score}·
 *       {@code other} 의 합이 줄 하나의 시간이다. {@code pron_*} 은 채점 서비스가 응답에 실어 보낸 자기 시간이라 {@code score}
 *       안에 든다: {@code score − pron_total} 이 요청이 오간 시간, {@code pron_total} 안에 {@code pron_decode}(녹음 풀기)·
 *       {@code pron_model}(모델 계산)·{@code pron_gop}(음소 비교)이 있다. 옛 채점 서비스는 보내지 않아 {@code pron_*} 이 없다.</li>
 *   <li>{@code acttub_reading_pronunciation_report_seconds} — 닫은(done·skipped) 보고서 하나. {@code wait} 는 처음 요청부터 일꾼이
 *       집기까지, {@code work} 는 집은 뒤 닫기까지다.</li>
 * </ul>
 *
 * <p>재는 일은 흐름을 바꾸지 않는다. 단계가 예외로 끝나도 쓴 시간은 남기고 예외는 그대로 나간다.
 */
public final class PronunciationMetrics {
    static final String LINE = "acttub.reading.pronunciation.line";
    static final String REPORT = "acttub.reading.pronunciation.report";
    private static final Duration[] LINE_BUCKETS = {
        Duration.ofMillis(10), Duration.ofMillis(25), Duration.ofMillis(50), Duration.ofMillis(100),
        Duration.ofMillis(250), Duration.ofMillis(500), Duration.ofSeconds(1), Duration.ofSeconds(2),
        Duration.ofSeconds(5), Duration.ofSeconds(10), Duration.ofSeconds(20), Duration.ofSeconds(30),
        Duration.ofSeconds(60), Duration.ofSeconds(120)
    };
    // 지난 30일 보고서 118건 중 10분을 넘은 것은 없었다(11/25 운영 최장 528초). 3분·10분·15분은 앱이 기다리는 시간이다.
    private static final Duration[] REPORT_BUCKETS = {
        Duration.ofSeconds(1), Duration.ofSeconds(5), Duration.ofSeconds(10), Duration.ofSeconds(30),
        Duration.ofSeconds(60), Duration.ofSeconds(180), Duration.ofSeconds(300), Duration.ofSeconds(600),
        Duration.ofSeconds(900), Duration.ofSeconds(1800), Duration.ofSeconds(3600)
    };

    /** 채점 서비스에 보낸 줄 하나의 단계. */
    public enum LineStage {
        /** 객체 저장소에서 녹음 내려받기. */
        DOWNLOAD,
        /** 채점 요청을 보내고 답을 읽기까지(오가는 시간 포함). */
        SCORE,
        /** 줄 하나에서 위 둘을 뺀 나머지(임시 파일 만들고 지우기 등). */
        OTHER,
        /** 채점 서비스가 녹음을 16kHz 파형으로 풀고 소리 없는 앞뒤를 잘라 내기까지. */
        PRON_DECODE,
        /** 채점 서비스의 음소 인식 모델 계산. */
        PRON_MODEL,
        /** 채점 서비스의 음소 비교(GOP)·시각 정렬·대본 닮음. */
        PRON_GOP,
        /** 채점 서비스가 요청을 받고 답을 만들기까지 전부. */
        PRON_TOTAL;

        String label() {
            return name().toLowerCase(Locale.ROOT);
        }
    }

    /** 닫은 보고서 하나의 단계. */
    public enum ReportStage {
        WAIT, WORK;

        String label() {
            return name().toLowerCase(Locale.ROOT);
        }
    }

    private final Map<LineStage, Timer> lines = new EnumMap<>(LineStage.class);
    private final Map<ReportStage, Timer> reports = new EnumMap<>(ReportStage.class);

    public PronunciationMetrics(MeterRegistry registry) {
        for (LineStage stage : LineStage.values()) {
            lines.put(stage, Timer.builder(LINE)
                    .description("Time spent in each stage of scoring one reading line for the pronunciation report")
                    .tags("stage", stage.label())
                    .serviceLevelObjectives(LINE_BUCKETS)
                    .register(registry));
        }
        for (ReportStage stage : ReportStage.values()) {
            reports.put(stage, Timer.builder(REPORT)
                    .description("Time a pronunciation report waited in the queue and took to score")
                    .tags("stage", stage.label())
                    .serviceLevelObjectives(REPORT_BUCKETS)
                    .register(registry));
        }
    }

    /** 보고서 하나의 시간을 모으기 시작한다. 한 일꾼 스레드에서만 쓴다. */
    public ReportTiming start() {
        return new ReportTiming();
    }

    /** 줄마다 남긴 시간의 합과 최댓값을 모아 보고서를 닫을 때 한 줄 로그로 낸다. */
    public final class ReportTiming {
        private final long started = System.nanoTime();
        private final Map<LineStage, long[]> sumMax = new EnumMap<>(LineStage.class);
        private long lineStarted;
        private long lineMeasured;

        /** 채점 서비스에 보내는 줄 하나를 시작한다. {@link #endLine()} 이 {@code other} 를 남긴다. */
        public void beginLine() {
            lineStarted = System.nanoTime();
            lineMeasured = 0;
        }

        /** 줄에서 {@code download}·{@code score} 로 잰 것을 뺀 나머지를 {@code other} 로 남긴다. */
        public void endLine() {
            record(LineStage.OTHER, System.nanoTime() - lineStarted - lineMeasured);
        }

        /** 줄 안의 단계 하나({@code download}·{@code score})를 재어 남긴다. 예외로 끝나도 남긴다. */
        public <T> T time(LineStage stage, Supplier<T> work) {
            long begin = System.nanoTime();
            try {
                return work.get();
            } finally {
                long nanos = System.nanoTime() - begin;
                lineMeasured += nanos;
                record(stage, nanos);
            }
        }

        /** 채점 서비스가 보낸 자기 시간. 없으면(옛 채점 서비스) 남기지 않는다. */
        public void server(ServerTime time) {
            if (time == null) {
                return;
            }
            record(LineStage.PRON_DECODE, TimeUnit.MILLISECONDS.toNanos(time.decodeMs()));
            record(LineStage.PRON_MODEL, TimeUnit.MILLISECONDS.toNanos(time.modelMs()));
            record(LineStage.PRON_GOP, TimeUnit.MILLISECONDS.toNanos(time.gopMs()));
            record(LineStage.PRON_TOTAL, TimeUnit.MILLISECONDS.toNanos(time.totalMs()));
        }

        private void record(LineStage stage, long nanos) {
            if (nanos < 0) {
                return;
            }
            lines.get(stage).record(nanos, TimeUnit.NANOSECONDS);
            long[] acc = sumMax.computeIfAbsent(stage, s -> new long[2]);
            acc[0] += nanos;
            acc[1] = Math.max(acc[1], nanos);
        }

        /**
         * 닫은 보고서의 대기·작업 시간을 남기고 로그 한 줄에 쓸 글을 돌려준다. 단계는 {@code <단계>_ms=<합>/<최댓값>} 이고 한 번도
         * 남지 않은 단계는 뺀다.
         *
         * @param wait 처음 요청부터 집기까지. 모르면 {@code null}
         */
        public String close(Duration wait) {
            long work = System.nanoTime() - started;
            reports.get(ReportStage.WORK).record(work, TimeUnit.NANOSECONDS);
            if (wait != null && !wait.isNegative()) {
                reports.get(ReportStage.WAIT).record(wait);
            }
            StringBuilder out = new StringBuilder()
                    .append("wait_ms=").append(wait == null ? "unknown" : String.valueOf(wait.toMillis()))
                    .append(" work_ms=").append(TimeUnit.NANOSECONDS.toMillis(work));
            for (LineStage stage : LineStage.values()) {
                long[] acc = sumMax.get(stage);
                if (acc != null) {
                    out.append(' ').append(stage.label()).append("_ms=").append(TimeUnit.NANOSECONDS.toMillis(acc[0]))
                            .append('/').append(TimeUnit.NANOSECONDS.toMillis(acc[1]));
                }
            }
            return out.toString();
        }
    }
}
