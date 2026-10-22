package com.acttub.actingapi.integration.media;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.ArrayList;
import java.util.List;
import org.opencv.core.Core;
import org.opencv.core.CvType;
import org.opencv.core.Mat;
import org.opencv.core.Size;
import org.opencv.objdetect.FaceDetectorYN;

/**
 * OpenCV 의 FaceDetectorYN(YuNet, MIT) 으로 얼굴을 찾는다. 네이티브는 openpnp jar 안의 것을 처음 쓸 때 임시 디렉터리에
 * 풀어 올리고(이미지에 따로 깔 것이 없다), 모델은 jar 안({@value #MODEL})의 것을 임시 파일로 꺼낸다. 놓치는 것이 지나치게
 * 가리는 것보다 나쁘므로 점수 문턱을 기본(0.9)보다 낮게 둔다.
 */
public final class YuNetFaceDetector implements FaceDetector {
    static final String MODEL = "/models/face/face_detection_yunet_2023mar.onnx";
    private static final float SCORE_THRESHOLD = 0.6f;
    private static final float NMS_THRESHOLD = 0.3f;
    private static final int TOP_K = 50;
    private static Path modelFile;

    private final FaceDetectorYN detector;
    private Mat frame;

    public YuNetFaceDetector() {
        String model = prepare().toString();
        this.detector = FaceDetectorYN.create(model, "", new Size(320, 320), SCORE_THRESHOLD, NMS_THRESHOLD, TOP_K);
    }

    @Override
    public List<Box> detect(byte[] bgr, int width, int height) {
        if (frame == null || frame.cols() != width || frame.rows() != height) {
            if (frame != null) frame.release();
            frame = new Mat(height, width, CvType.CV_8UC3);
        }
        frame.put(0, 0, bgr);
        detector.setInputSize(new Size(width, height));
        Mat faces = new Mat();
        try {
            detector.detect(frame, faces);
            List<Box> boxes = new ArrayList<>(faces.rows());
            float[] row = new float[Math.max(1, faces.cols())];
            for (int i = 0; i < faces.rows(); i++) {
                faces.get(i, 0, row);
                boxes.add(new Box(row[0], row[1], row[2], row[3]));
            }
            return boxes;
        } finally {
            faces.release();
        }
    }

    @Override
    public void close() {
        if (frame != null) frame.release();
    }

    /** 네이티브를 한 번 올리고 모델 파일을 꺼낸다. */
    private static synchronized Path prepare() {
        if (modelFile != null && Files.isRegularFile(modelFile)) {
            return modelFile;
        }
        nu.pattern.OpenCV.loadLocally();
        // 영상 하나를 한 스레드에서 돈다 — 컨테이너 CPU 한도 안에서 다른 일을 밀어내지 않는다.
        Core.setNumThreads(1);
        try (InputStream in = YuNetFaceDetector.class.getResourceAsStream(MODEL)) {
            if (in == null) {
                throw new IllegalStateException("face model is missing: " + MODEL);
            }
            // 임시 디렉터리는 모두가 쓰는 곳이라 본인만 읽고 쓰는 파일로 만든다.
            Path file = Files.createTempFile("acttub-yunet-", ".onnx",
                    PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
            Files.copy(in, file, StandardCopyOption.REPLACE_EXISTING);
            file.toFile().deleteOnExit();
            modelFile = file;
            return file;
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        }
    }
}
