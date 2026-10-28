package com.acttub.actingapi.integration.media;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/**
 * 참여작 영상의 얼굴을 픽셀 모자이크로 가린 사본을 만든다 (challenge.entry 얼굴 모자이크). 원본은 건드리지 않는다.
 *
 * <p>두 번 읽는다. <b>찾기</b>는 ffmpeg 가 30fps·작은 크기로 풀어 준 프레임에서 {@value #STRIDE} 프레임마다 얼굴을
 * 찾는다(긴 변 {@value #DETECT_LONG_SIDE}). <b>그리기</b>는 같은 30fps 로 다시 풀어 프레임마다 그 근처에서 찾은 상자를 모두 넓혀 모자이크하고 ffmpeg 로
 * 다시 압축하며 원본 소리를 붙인다. 근처란 앞으로 {@value #LEAD_FRAMES} 프레임·뒤로 {@value #HOLD_FRAMES}
 * 프레임(1초)이다 — 찾기 사이에 얼굴이 움직여도, 한동안 놓쳐도 직전 상자가 남는다. 상자는 좌우로
 * {@value #SIDE_MARGIN}배, 위로 {@value #TOP_MARGIN}배, 아래로 {@value #BOTTOM_MARGIN}배를 더 넓혀 머리선·턱까지 덮는다.
 *
 * <p><b>얼굴을 한 번도 찾지 못하면 {@link NoFaceFound} 다</b> — 부르는 쪽은 모자이크본 없이 실패로 닫는다(가리지 못한
 * 사본을 공개용으로 내지 않는다). 각 단계는 {@link FfmpegLock} 을 따로 잡는다 — 다른 영상 일이 그 사이에 끼어든다.
 */
public final class FaceMosaicRenderer implements FaceMosaic {
    static final int FPS = 30;
    static final int STRIDE = 3;
    static final int LEAD_FRAMES = STRIDE + 3;
    static final int HOLD_FRAMES = FPS;
    static final double SIDE_MARGIN = 0.4;
    static final double TOP_MARGIN = 0.5;
    static final double BOTTOM_MARGIN = 0.35;
    /** 모자이크 칸은 찾은 얼굴의 폭(넓히기 전)을 이만큼으로 나눈다 — 얼굴 폭 하나가 가로 3칸 안팎이다. */
    static final int BLOCKS_PER_FACE = 3;
    static final int MIN_BLOCK = 8;
    private static final int OUTPUT_LONG_SIDE = 1280;
    private static final int DETECT_LONG_SIDE = 960;
    private static final Duration TIMEOUT = Duration.ofMinutes(10);
    private static final Pattern EXECUTABLE = Pattern.compile(Pattern.quote(File.pathSeparator));

    /** 진짜 ffmpeg 프로세스를 띄운다. 표준 오류는 버린다. */
    @FunctionalInterface
    public interface Launcher {
        Process start(List<String> command) throws IOException;
    }

    /** 영상 전체에서 얼굴을 하나도 찾지 못했다. 다시 해도 같다. */
    public static final class NoFaceFound extends Exception {
        public NoFaceFound() {
            super("no face found in the video");
        }
    }

    private final Supplier<FaceDetector> detectors;
    private final Launcher launcher;
    private final String ffmpeg;

    public FaceMosaicRenderer() {
        this(YuNetFaceDetector::new);
    }

    /** PATH 의 ffmpeg 로 돌리되 얼굴 찾기만 바꿔 끼운다(시험에서 네이티브 없이 전체 흐름을 볼 때). */
    public FaceMosaicRenderer(Supplier<FaceDetector> detectors) {
        this(detectors, FaceMosaicRenderer::launch, executable("ffmpeg"));
    }

    FaceMosaicRenderer(Supplier<FaceDetector> detectors, Launcher launcher, String ffmpeg) {
        this.detectors = detectors;
        this.launcher = launcher;
        this.ffmpeg = ffmpeg;
    }

    /** ffmpeg 가 PATH 에 있는가. 없으면 워커가 아무것도 집지 않는다. */
    @Override
    public boolean available() {
        return ffmpeg != null;
    }

    /**
     * {@code source} 옆에 모자이크한 mp4 를 만든다. 반환한 파일은 호출자가 지운다.
     *
     * @throws NoFaceFound 얼굴을 한 번도 찾지 못했다
     */
    @Override
    public Path render(Path source) throws Exception {
        if (ffmpeg == null) {
            throw new IllegalStateException("ffmpeg is unavailable");
        }
        long deadline = System.nanoTime() + TIMEOUT.toNanos();
        int[] display = FfmpegLock.run(() -> displaySize(source));
        int[] output = fit(display[0], display[1], OUTPUT_LONG_SIDE);
        int[] small = fit(display[0], display[1], DETECT_LONG_SIDE);
        Plan plan = FfmpegLock.run(() -> detect(source, small, deadline));
        if (plan.empty()) {
            throw new NoFaceFound();
        }
        Path out = Files.createTempFile(source.toAbsolutePath().getParent(), "acttub-mosaic-", ".mp4");
        try {
            FfmpegLock.run(() -> {
                draw(source, out, output, plan, deadline);
                return null;
            });
            if (Files.size(out) == 0) {
                throw new IOException("ffmpeg produced an empty mosaic");
            }
            return out;
        } catch (Exception failure) {
            Files.deleteIfExists(out);
            throw failure;
        }
    }

    /** 회전을 반영한 표시 크기 — 첫 프레임을 PNG 로 뽑아 머리만 읽는다. */
    private int[] displaySize(Path source) throws IOException, InterruptedException {
        Process process = launcher.start(List.of(ffmpeg, "-v", "error", "-i", source.toString(), "-frames:v", "1",
                "-f", "image2pipe", "-vcodec", "png", "-"));
        try {
            byte[] png = process.getInputStream().readAllBytes();
            finish(process, "size probe");
            return pngSize(png);
        } finally {
            process.destroyForcibly();
        }
    }

    private Plan detect(Path source, int[] size, long deadline) throws IOException, InterruptedException {
        Process decoder = launcher.start(decode(source, size));
        Watchdog watchdog = new Watchdog(deadline, decoder);
        try (FaceDetector detector = detectors.get();
             InputStream in = new BufferedInputStream(decoder.getInputStream(), 1 << 20)) {
            byte[] frame = new byte[size[0] * size[1] * 3];
            Map<Integer, List<double[]>> samples = new HashMap<>();
            int index = 0;
            while (readFrame(in, frame)) {
                if (index % STRIDE == 0) {
                    List<double[]> found = new ArrayList<>();
                    for (FaceDetector.Box box : detector.detect(frame, size[0], size[1])) {
                        // 크기와 무관한 비율로 남긴다 — 그리기는 더 큰 프레임이다.
                        found.add(new double[] {box.x() / size[0], box.y() / size[1],
                            box.width() / size[0], box.height() / size[1]});
                    }
                    if (!found.isEmpty()) {
                        samples.put(index, found);
                    }
                }
                index++;
            }
            finish(decoder, "face detection");
            return new Plan(samples);
        } finally {
            watchdog.stop();
            decoder.destroyForcibly();
        }
    }

    private void draw(Path source, Path out, int[] size, Plan plan, long deadline) throws IOException, InterruptedException {
        int width = size[0];
        int height = size[1];
        Process decoder = launcher.start(decode(source, size));
        Process encoder = launcher.start(List.of(ffmpeg, "-v", "error", "-y",
                "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", width + "x" + height, "-framerate", String.valueOf(FPS),
                "-i", "-", "-i", source.toString(),
                "-map", "0:v:0", "-map", "1:a:0?",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-threads", "1", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", out.toString()));
        Watchdog watchdog = new Watchdog(deadline, decoder, encoder);
        try (InputStream in = new BufferedInputStream(decoder.getInputStream(), 1 << 20);
             OutputStream sink = new BufferedOutputStream(encoder.getOutputStream(), 1 << 20)) {
            byte[] frame = new byte[width * height * 3];
            int index = 0;
            while (readFrame(in, frame)) {
                pixelate(frame, width, height, plan.boxes(index));
                sink.write(frame);
                index++;
            }
            sink.flush();
            sink.close();
            finish(decoder, "mosaic decode");
            finish(encoder, "mosaic encode");
        } finally {
            watchdog.stop();
            decoder.destroyForcibly();
            encoder.destroyForcibly();
        }
    }

    private List<String> decode(Path source, int[] size) {
        return List.of(ffmpeg, "-v", "error", "-i", source.toString(), "-an",
                "-vf", "fps=" + FPS + ",scale=" + size[0] + ":" + size[1], "-f", "rawvideo", "-pix_fmt", "bgr24", "-");
    }

    private static void finish(Process process, String job) throws IOException, InterruptedException {
        if (!process.waitFor(1, TimeUnit.MINUTES)) {
            throw new IOException("ffmpeg " + job + " timed out");
        }
        if (process.exitValue() != 0) {
            throw new IOException("ffmpeg " + job + " exited with status " + process.exitValue());
        }
    }

    /** 프레임 하나를 꽉 채워 읽는다. 프레임 경계에서 끝나면 {@code false}, 중간에서 끝나면 실패다. */
    static boolean readFrame(InputStream in, byte[] frame) throws IOException {
        int read = 0;
        while (read < frame.length) {
            int n = in.read(frame, read, frame.length - read);
            if (n < 0) {
                if (read == 0) {
                    return false;
                }
                throw new IOException("truncated frame");
            }
            read += n;
        }
        return true;
    }

    /** 긴 변을 {@code longSide} 이하로 줄이고 두 변을 짝수로 맞춘다(키우지 않는다). */
    static int[] fit(int width, int height, int longSide) {
        double scale = Math.min(1.0, (double) longSide / Math.max(width, height));
        int w = Math.max(2, (int) Math.round(width * scale) & ~1);
        int h = Math.max(2, (int) Math.round(height * scale) & ~1);
        return new int[] {w, h};
    }

    static int[] pngSize(byte[] png) throws IOException {
        if (png.length < 24 || (png[0] & 0xff) != 0x89 || png[1] != 'P' || png[2] != 'N' || png[3] != 'G') {
            throw new IOException("ffmpeg returned no frame");
        }
        int width = ((png[16] & 0xff) << 24) | ((png[17] & 0xff) << 16) | ((png[18] & 0xff) << 8) | (png[19] & 0xff);
        int height = ((png[20] & 0xff) << 24) | ((png[21] & 0xff) << 16) | ((png[22] & 0xff) << 8) | (png[23] & 0xff);
        if (width <= 0 || height <= 0) {
            throw new IOException("ffmpeg returned an empty frame");
        }
        return new int[] {width, height};
    }

    /**
     * 비율 상자들을 넓혀 그 안을 칸마다 평균색으로 칠한다. 프레임은 bgr24 이고 제자리에서 바뀐다.
     *
     * @param boxes {x, y, w, h} — 프레임 크기에 대한 비율
     */
    static void pixelate(byte[] frame, int width, int height, List<double[]> boxes) {
        for (double[] box : boxes) {
            double bw = box[2] * width;
            double bh = box[3] * height;
            int x0 = clamp((int) Math.floor(box[0] * width - bw * SIDE_MARGIN), width);
            int x1 = clamp((int) Math.ceil(box[0] * width + bw * (1 + SIDE_MARGIN)), width);
            int y0 = clamp((int) Math.floor(box[1] * height - bh * TOP_MARGIN), height);
            int y1 = clamp((int) Math.ceil(box[1] * height + bh * (1 + BOTTOM_MARGIN)), height);
            if (x1 <= x0 || y1 <= y0) {
                continue;
            }
            int block = blockSize(bw, bh);
            for (int by = y0; by < y1; by += block) {
                int ey = Math.min(by + block, y1);
                for (int bx = x0; bx < x1; bx += block) {
                    int ex = Math.min(bx + block, x1);
                    long b = 0;
                    long g = 0;
                    long r = 0;
                    for (int y = by; y < ey; y++) {
                        int row = y * width * 3;
                        for (int x = bx; x < ex; x++) {
                            int p = row + x * 3;
                            b += frame[p] & 0xff;
                            g += frame[p + 1] & 0xff;
                            r += frame[p + 2] & 0xff;
                        }
                    }
                    long count = (long) (ey - by) * (ex - bx);
                    byte mb = (byte) (b / count);
                    byte mg = (byte) (g / count);
                    byte mr = (byte) (r / count);
                    for (int y = by; y < ey; y++) {
                        int row = y * width * 3;
                        for (int x = bx; x < ex; x++) {
                            int p = row + x * 3;
                            frame[p] = mb;
                            frame[p + 1] = mg;
                            frame[p + 2] = mr;
                        }
                    }
                }
            }
        }
    }

    /** 칸 한 변(픽셀). 찾은 얼굴의 폭(세로가 더 길면 세로의 0.8배) 기준이라 해상도가 높아도 칸 수는 같다. */
    static int blockSize(double faceWidth, double faceHeight) {
        return Math.max(MIN_BLOCK, (int) Math.round(Math.max(faceWidth, faceHeight * 0.8) / BLOCKS_PER_FACE));
    }

    private static int clamp(int value, int limit) {
        return Math.max(0, Math.min(limit, value));
    }

    /** 찾은 얼굴을 프레임마다 펼친다. 프레임 i 는 찾기 시점 s 가 {@code s-LEAD ≤ i ≤ s+HOLD} 인 상자를 모두 받는다. */
    static final class Plan {
        private final Map<Integer, List<double[]>> samples;

        Plan(Map<Integer, List<double[]>> samples) {
            this.samples = samples;
        }

        boolean empty() {
            return samples.isEmpty();
        }

        List<double[]> boxes(int frame) {
            List<double[]> boxes = new ArrayList<>();
            int from = frame - HOLD_FRAMES;
            int to = frame + LEAD_FRAMES;
            for (int sample = from - Math.floorMod(from, STRIDE); sample <= to; sample += STRIDE) {
                List<double[]> found = samples.get(sample);
                if (found != null && sample >= from) {
                    boxes.addAll(found);
                }
            }
            return boxes;
        }
    }

    /** 시한이 지나면 프로세스를 끝낸다 — 읽기·쓰기가 막혀 있어도 풀린다. */
    private static final class Watchdog {
        private final Thread thread;

        Watchdog(long deadline, Process... processes) {
            this.thread = Thread.ofVirtual().start(() -> {
                try {
                    long wait = deadline - System.nanoTime();
                    if (wait > 0) {
                        TimeUnit.NANOSECONDS.sleep(wait);
                    }
                    for (Process process : processes) {
                        process.destroyForcibly();
                    }
                } catch (InterruptedException stopped) {
                    // 끝났다 — 일이 시한 안에 마쳤다.
                    Thread.currentThread().interrupt();
                }
            });
        }

        void stop() {
            thread.interrupt();
        }
    }

    private static Process launch(List<String> command) throws IOException {
        return new ProcessBuilder(command).redirectError(ProcessBuilder.Redirect.DISCARD).start();
    }

    private static String executable(String command) {
        String path = System.getenv("PATH");
        if (path == null) {
            return null;
        }
        for (String directory : EXECUTABLE.split(path)) {
            Path candidate = Path.of(directory, command);
            if (Files.isRegularFile(candidate) && Files.isExecutable(candidate)) {
                return candidate.toString();
            }
        }
        return null;
    }
}
