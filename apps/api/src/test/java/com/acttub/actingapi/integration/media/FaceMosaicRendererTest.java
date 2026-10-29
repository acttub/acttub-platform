package com.acttub.actingapi.integration.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** 얼굴 모자이크의 순수 계산 — 타원 흐림·상자 펼치기·크기 맞추기. ffmpeg·네이티브 없이 돈다. */
class FaceMosaicRendererTest {

    @Test void blurFacesSoftensTheFaceOvalAndLeavesTheNeckAndBackgroundAlone() {
        int width = 200;
        int height = 200;
        byte[] frame = stripes(width, height);
        // 얼굴 상자 (80,80)~(120,120). 타원 중심 (100,96), 반지름 가로 24.8·세로 27.2 — 위 69, 아래 123.
        FaceMosaicRenderer.blurFaces(frame, width, height, List.<double[]>of(new double[] {0.4, 0.4, 0.2, 0.2}));
        assertThat(pixel(frame, width, 100, 100)).isBetween(80, 120);  // 얼굴 가운데는 흐려진다
        assertThat(pixel(frame, width, 100, 76)).isBetween(80, 120);   // 이마도
        assertThat(pixel(frame, width, 100, 132)).isIn(0, 200);        // 턱 아래 목은 그대로
        assertThat(pixel(frame, width, 70, 100)).isIn(0, 200);         // 옆 배경도 그대로
        assertThat(pixel(frame, width, 100, 60)).isIn(0, 200);         // 머리 위도
    }

    @Test void blurFacesFadesAtTheOvalEdgeInsteadOfACutLine() {
        int width = 200;
        int height = 200;
        byte[] frame = stripes(width, height);
        FaceMosaicRenderer.blurFaces(frame, width, height, List.<double[]>of(new double[] {0.4, 0.4, 0.2, 0.2}));
        // 가장자리 띠(가로 76~79)는 원본과 흐림 사이 — 줄무늬가 남되 줄어든다.
        int edge = Math.abs(pixel(frame, width, 77, 96) - pixel(frame, width, 78, 96));
        assertThat(edge).isGreaterThan(0).isLessThan(200);
    }

    @Test void blurRadiusFollowsTheFaceWidth() {
        for (int faceWidth : new int[] {60, 120, 240, 480}) {
            assertThat(faceWidth / (double) FaceMosaicRenderer.blurRadius(faceWidth)).isBetween(6.0, 8.0);
        }
        assertThat(FaceMosaicRenderer.blurRadius(10)).isEqualTo(FaceMosaicRenderer.MIN_RADIUS);
    }

    @Test void blurFacesClipsAtTheFrameEdgeAndIgnoresEmptyBoxes() {
        byte[] frame = new byte[10 * 10 * 3];
        FaceMosaicRenderer.blurFaces(frame, 10, 10, List.<double[]>of(new double[] {-0.5, 0.8, 2.0, 0.9}));
        FaceMosaicRenderer.blurFaces(frame, 10, 10, List.<double[]>of(new double[] {0.5, 0.5, 0, 0}));
        FaceMosaicRenderer.blurFaces(frame, 10, 10, List.of());
        assertThat(frame).hasSize(300);
    }

    private static byte[] stripes(int width, int height) {
        byte[] frame = new byte[width * height * 3];
        // 세로 줄무늬 — 흐리면 줄무늬가 사라져 중간값이 된다.
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                int p = (y * width + x) * 3;
                byte v = (byte) (x % 2 == 0 ? 0 : 200);
                frame[p] = v; frame[p + 1] = v; frame[p + 2] = v;
            }
        }
        return frame;
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
