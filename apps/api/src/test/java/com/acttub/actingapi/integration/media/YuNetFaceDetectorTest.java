package com.acttub.actingapi.integration.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.util.Arrays;
import org.junit.jupiter.api.Test;

/**
 * 실제 YuNet — 빌드는 운영 서버와 같은 x86_64 리눅스 네이티브만 싣는다(build.gradle.kts opencvLinuxJar). 그 플랫폼(CI)에서
 * 네이티브가 올라오고 모델을 읽어 빈 화면에 얼굴이 없다고 답하는지 본다. 다른 플랫폼은 건너뛴다
 * ({@code -PopencvAllPlatforms} 로 돌리면 맥에서도 돈다).
 */
class YuNetFaceDetectorTest {

    @Test void loadsTheNativeAndFindsNoFaceInAPlainFrame() {
        assumeTrue(nativeAvailable(), "이 플랫폼의 OpenCV 네이티브가 jar 에 없어 건너뛴다");
        byte[] gray = new byte[320 * 240 * 3];
        Arrays.fill(gray, (byte) 128);
        try (var detector = new YuNetFaceDetector()) {
            assertThat(detector.detect(gray, 320, 240)).isEmpty();
            // 크기가 바뀌어도 다시 쓴다.
            assertThat(detector.detect(new byte[160 * 120 * 3], 160, 120)).isEmpty();
        }
    }

    private static boolean nativeAvailable() {
        String os = System.getProperty("os.name").toLowerCase();
        String arch = System.getProperty("os.arch").toLowerCase();
        String folder = os.contains("linux") && (arch.equals("amd64") || arch.equals("x86_64")) ? "linux/x86_64"
                : os.contains("mac") && arch.equals("aarch64") ? "osx/ARMv8" : null;
        return folder != null && YuNetFaceDetectorTest.class.getResource("/nu/pattern/opencv/" + folder) != null;
    }
}
