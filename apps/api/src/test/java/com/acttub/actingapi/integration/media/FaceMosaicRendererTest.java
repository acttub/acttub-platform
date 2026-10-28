package com.acttub.actingapi.integration.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** 얼굴 모자이크의 순수 계산 — 칠하기·상자 펼치기·크기 맞추기. ffmpeg·네이티브 없이 돈다. */
class FaceMosaicRendererTest {

    @Test void pixelateCoversTheWidenedBoxWithBlockAveragesAndLeavesTheRestAlone() {
        int width = 200;
        int height = 200;
        byte[] frame = new byte[width * height * 3];
        // 가로 줄무늬 — 칸 평균을 내면 줄무늬가 사라진다.
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                int p = (y * width + x) * 3;
                byte v = (byte) (x % 2 == 0 ? 0 : 200);
                frame[p] = v; frame[p + 1] = v; frame[p + 2] = v;
            }
        }
        // 얼굴 상자 (80,80)~(120,120). 넓히면 x 64~136, y 60~134 이다.
        FaceMosaicRenderer.pixelate(frame, width, height, List.<double[]>of(new double[] {0.4, 0.4, 0.2, 0.2}));
        assertThat(pixel(frame, width, 100, 100)).isBetween(90, 110);
        assertThat(pixel(frame, width, 65, 61)).isBetween(90, 110);   // 넓힌 귀퉁이도 가린다
        assertThat(pixel(frame, width, 135, 133)).isBetween(90, 110);
        assertThat(pixel(frame, width, 55, 100)).isIn(0, 200);       // 밖은 그대로
        assertThat(pixel(frame, width, 100, 145)).isIn(0, 200);
        assertThat(pixel(frame, width, 100, 50)).isIn(0, 200);
    }

    @Test void blockCountAcrossTheFaceStaysTheSameAtAnyResolution() {
        for (int faceWidth : new int[] {60, 120, 240, 480}) {
            int block = FaceMosaicRenderer.blockSize(faceWidth, faceWidth * 1.2);
            assertThat(faceWidth / (double) block).isLessThanOrEqualTo(8).isGreaterThanOrEqualTo(2);
        }
        // 얼굴이 아주 작으면 칸이 하한보다 작아지지 않는다.
        assertThat(FaceMosaicRenderer.blockSize(16, 20)).isEqualTo(FaceMosaicRenderer.MIN_BLOCK);
    }

    @Test void pixelateClipsBoxesAtTheFrameEdge() {
        byte[] frame = new byte[10 * 10 * 3];
        FaceMosaicRenderer.pixelate(frame, 10, 10, List.<double[]>of(new double[] {-0.5, 0.8, 2.0, 0.9}));
        assertThat(frame).hasSize(300);
    }

    @Test void planHoldsTheLastBoxForASecondAndLeadsIntoTheNextDetection() {
        var plan = new FaceMosaicRenderer.Plan(Map.of(30, List.<double[]>of(new double[] {0.1, 0.1, 0.1, 0.1})));
        assertThat(plan.empty()).isFalse();
        assertThat(plan.boxes(30 - FaceMosaicRenderer.LEAD_FRAMES)).hasSize(1);
        assertThat(plan.boxes(30 - FaceMosaicRenderer.LEAD_FRAMES - 1)).isEmpty();
        assertThat(plan.boxes(30 + FaceMosaicRenderer.HOLD_FRAMES)).hasSize(1);
        assertThat(plan.boxes(30 + FaceMosaicRenderer.HOLD_FRAMES + 1)).isEmpty();
        assertThat(new FaceMosaicRenderer.Plan(Map.of()).empty()).isTrue();
    }

    @Test void planUnionsNeighbouringDetectionsSoAMovingFaceStaysCovered() {
        var plan = new FaceMosaicRenderer.Plan(Map.of(
                0, List.<double[]>of(new double[] {0.1, 0.1, 0.1, 0.1}),
                3, List.<double[]>of(new double[] {0.2, 0.1, 0.1, 0.1})));
        assertThat(plan.boxes(1)).hasSize(2);
    }

    @Test void fitKeepsEvenSidesAndNeverUpscales() {
        assertThat(FaceMosaicRenderer.fit(720, 1280, 1280)).containsExactly(720, 1280);
        assertThat(FaceMosaicRenderer.fit(1080, 1920, 640)).containsExactly(360, 640);
        assertThat(FaceMosaicRenderer.fit(721, 1281, 640)).containsExactly(360, 640);
        assertThat(FaceMosaicRenderer.fit(320, 240, 1280)).containsExactly(320, 240);
    }

    @Test void pngSizeReadsTheHeaderAndRejectsNonPng() throws IOException {
        byte[] png = new byte[24];
        png[0] = (byte) 0x89; png[1] = 'P'; png[2] = 'N'; png[3] = 'G';
        png[18] = 0x02; png[19] = (byte) 0xD0; // 720
        png[22] = 0x05; png[23] = 0x00;        // 1280
        assertThat(FaceMosaicRenderer.pngSize(png)).containsExactly(720, 1280);
        assertThatThrownBy(() -> FaceMosaicRenderer.pngSize(new byte[3])).isInstanceOf(IOException.class);
    }

    @Test void readFrameStopsAtABoundaryAndRejectsATruncatedFrame() throws IOException {
        byte[] frame = new byte[4];
        var whole = new ByteArrayInputStream(new byte[8]);
        assertThat(FaceMosaicRenderer.readFrame(whole, frame)).isTrue();
        assertThat(FaceMosaicRenderer.readFrame(whole, frame)).isTrue();
        assertThat(FaceMosaicRenderer.readFrame(whole, frame)).isFalse();
        var truncated = new ByteArrayInputStream(new byte[6]);
        assertThat(FaceMosaicRenderer.readFrame(truncated, frame)).isTrue();
        assertThatThrownBy(() -> FaceMosaicRenderer.readFrame(truncated, frame)).isInstanceOf(IOException.class);
    }

    @Test void renderWithoutFfmpegRefusesAndIsUnavailable() {
        var renderer = new FaceMosaicRenderer(() -> (bgr, w, h) -> List.of(), command -> {
            throw new IOException("no process");
        }, null);
        assertThat(renderer.available()).isFalse();
        assertThatThrownBy(() -> renderer.render(java.nio.file.Path.of("x"))).isInstanceOf(IllegalStateException.class);
    }

    private static int pixel(byte[] frame, int width, int x, int y) {
        return frame[(y * width + x) * 3] & 0xff;
    }
}
