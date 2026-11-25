package com.acttub.actingapi.feature.challenge.adapter.media;

import static org.assertj.core.api.Assertions.assertThat;

import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.util.stream.IntStream;
import com.acttub.actingapi.feature.challenge.domain.ShareFrames;
import com.acttub.actingapi.feature.challenge.domain.ShareFrames.Card;
import com.acttub.actingapi.feature.challenge.domain.ShareFrames.Frame;
import com.acttub.actingapi.feature.challenge.domain.ShareFrames.Rect;
import org.junit.jupiter.api.Test;

/** 틀 그림과 미리보기 한 장의 픽셀 (challenge.entry 공유 프레임, SOMA-1156). ffmpeg 없이 Java2D 만 본다. */
class ShareFrameOverlayTest {
    private static final String LINE = "괜찮아, 진짜 괜찮다니까.\n…근데 왜 나한테만 말 안 했어?";

    @Test void theOverlayIsFullSizeWithATransparentWindowAndTheFrameColourAround() {
        for (Frame frame : Frame.values()) {
            BufferedImage overlay = ShareFrameOverlay.draw(card(frame), ShareFrames.SCALE);
            assertThat(overlay.getWidth()).isEqualTo(1080);
            assertThat(overlay.getHeight()).isEqualTo(1920);
            Rect w = ShareFrames.WINDOW;
            // 창 한가운데는 비어 있어 영상이 보인다.
            assertThat(alpha(overlay, w.x() + w.width() / 2, w.y() + w.height() / 2)).as(frame.id()).isZero();
            // 창 바깥 여백은 프레임 배경색이다.
            assertThat(argb(overlay, 20, 300)).as(frame.id()).isEqualTo(frame.palette().background());
            assertThat(argb(overlay, 200, 700)).as(frame.id()).isEqualTo(frame.palette().background());
            // 창의 둥근 모서리 바깥은 배경이 덮는다.
            assertThat(alpha(overlay, w.right() - 0.5, w.bottom() - 0.5)).as(frame.id()).isEqualTo(255);
        }
    }

    @Test void perforationsUseTheFrameColour() {
        Rect hole = ShareFrames.perforations().get(5);
        Rect right = ShareFrames.mirror(hole);
        BufferedImage white = ShareFrameOverlay.draw(card(Frame.WHITE), ShareFrames.SCALE);
        assertThat(argb(white, hole.x() + hole.width() / 2, hole.y() + hole.height() / 2)).isEqualTo(0xFFE5E8EB);
        assertThat(argb(white, right.x() + right.width() / 2, right.y() + right.height() / 2)).isEqualTo(0xFFE5E8EB);
        BufferedImage black = ShareFrameOverlay.draw(card(Frame.BLACK), ShareFrames.SCALE);
        assertThat(argb(black, hole.x() + hole.width() / 2, hole.y() + hole.height() / 2)).isEqualTo(0xFF2A2D35);
        // 파랑의 구멍은 반투명 흰색이 파랑 위에 얹힌 색이다(틀 그림 자체는 불투명).
        BufferedImage blue = ShareFrameOverlay.draw(card(Frame.BLUE), ShareFrames.SCALE);
        int mixed = argb(blue, hole.x() + hole.width() / 2, hole.y() + hole.height() / 2);
        assertThat(mixed >>> 24).isEqualTo(255);
        assertThat(mixed).isNotEqualTo(Frame.BLUE.palette().background());
    }

    @Test void theRecChipIsTranslucentOverTheVideo() {
        BufferedImage overlay = ShareFrameOverlay.draw(card(Frame.WHITE), ShareFrames.SCALE);
        Rect w = ShareFrames.WINDOW;
        int a = alpha(overlay, w.right() - ShareFrames.REC_INSET - 3, w.y() + ShareFrames.REC_INSET + ShareFrames.REC_HEIGHT / 2);
        assertThat(a).isBetween(100, 200);
    }

    @Test void theBadgeUsesTheFrameBadgeColour() {
        BufferedImage blue = ShareFrameOverlay.draw(card(Frame.BLUE), ShareFrames.SCALE);
        // 배지 오른쪽 안쪽(글자 밖) — 파랑 프레임의 배지는 흰 바탕이다.
        double y = ShareFrames.TITLE_BOX.y() + ShareFrames.TITLE_BOX.height() / 2;
        assertThat(argb(blue, ShareFrames.PAD + ShareFrames.INNER_WIDTH - 5, y)).isEqualTo(0xFFFFFFFF);
        BufferedImage white = ShareFrameOverlay.draw(card(Frame.WHITE), ShareFrames.SCALE);
        assertThat(argb(white, ShareFrames.PAD + ShareFrames.INNER_WIDTH - 5, y)).isEqualTo(0xFF4880EE);
    }

    @Test void lettersTheBundledSubsetLacksAreLeftOutInsteadOfDrawnAsBoxes() {
        Font bold = boldFont();
        int missing = IntStream.rangeClosed(0xAC00, 0xD7A3).filter(cp -> !bold.canDisplay(cp)).findFirst().orElseThrow();
        String rare = Character.toString(missing);
        assertThat(ShareFrameOverlay.displayable("괜찮아" + rare + " 😀漢\n다시")).isEqualTo("괜찮아 \n다시");
        assertThat(ShareFrameOverlay.displayable("괜찮아, 진짜로.")).isEqualTo("괜찮아, 진짜로.");
        // 그려도 넘어지지 않는다.
        ShareFrameOverlay.draw(new Card(Frame.BLACK, rare + "😀", 1, rare + "漢", "2026.11.02"), ShareFrames.SCALE);
    }

    private static Font boldFont() {
        try (var in = ShareFrameOverlay.class.getResourceAsStream("/share-frame/Pretendard-Bold.subset.ttf")) {
            return Font.createFont(Font.TRUETYPE_FONT, in);
        } catch (Exception failure) {
            throw new IllegalStateException(failure);
        }
    }

    @Test void theFontLicenceShipsNextToTheFonts() {
        assertThat(ShareFrameOverlay.class.getResource("/share-frame/OFL.txt")).isNotNull();
    }

    @Test void aMemberChallengeHasNoBadge() {
        BufferedImage member = ShareFrameOverlay.draw(new Card(Frame.WHITE, LINE, null, "WooYoung", "2026.11.02"), ShareFrames.SCALE);
        double y = ShareFrames.TITLE_BOX.y() + ShareFrames.TITLE_BOX.height() / 2;
        // 배지 자리가 프레임 바탕(흰색) 그대로다.
        assertThat(argb(member, ShareFrames.PAD + ShareFrames.INNER_WIDTH - 5, y)).isEqualTo(0xFFFFFFFF);
    }

    @Test void aVeryLongLineAndNameStillDraw() {
        var card = new Card(Frame.WHITE, "가".repeat(400), 123, "아주아주긴이름을가진배우의이름입니다".repeat(3), "2026.11.25");
        BufferedImage overlay = ShareFrameOverlay.draw(card, ShareFrames.SCALE);
        assertThat(overlay.getWidth()).isEqualTo(1080);
        assertThat(ShareFrames.quotedLines(card.line(), ShareFrameOverlay::lineWidth)).hasSize(3);
    }

    @Test void theWhiteWordmarkKeepsItsShapeAndTurnsWhite() {
        BufferedImage source = new BufferedImage(2, 1, BufferedImage.TYPE_INT_ARGB);
        source.setRGB(0, 0, 0xFF1F6FEB);
        source.setRGB(1, 0, 0x00000000);
        BufferedImage white = ShareFrameOverlay.tint(source, 0xFFFFFF);
        assertThat(white.getRGB(0, 0)).isEqualTo(0xFFFFFFFF);
        assertThat(white.getRGB(1, 0) >>> 24).isZero();
    }

    @Test void thePreviewPutsTheStillInTheWindowUnderTheSameFrame() {
        BufferedImage still = solid(720, 1280, Color.RED);
        BufferedImage preview = StorageEntryShareFrames.preview(card(Frame.BLACK), still);
        assertThat(preview.getWidth()).isEqualTo(540);
        assertThat(preview.getHeight()).isEqualTo(960);
        double scale = 540 / ShareFrames.WIDTH;
        Rect w = ShareFrames.WINDOW;
        int centre = preview.getRGB((int) ((w.x() + w.width() / 2) * scale), (int) ((w.y() + w.height() / 2) * scale));
        assertThat(centre & 0xFFFFFF).isEqualTo(0xFF0000);
        assertThat(preview.getRGB((int) (20 * scale), (int) (320 * scale)) & 0xFFFFFF).isEqualTo(0x111318);
    }

    @Test void theNonePreviewIsOnlyTheStill() {
        BufferedImage preview = StorageEntryShareFrames.preview(
                new Card(null, LINE, 2, "WooYoung", "2026.11.02"), solid(1080, 1920, Color.GREEN));
        assertThat(preview.getRGB(2, 2) & 0xFFFFFF).isEqualTo(0x00FF00);
        assertThat(preview.getRGB(270, 480) & 0xFFFFFF).isEqualTo(0x00FF00);
    }

    private static Card card(Frame frame) { return new Card(frame, LINE, 2, "WooYoung", "2026.11.02"); }

    private static int argb(BufferedImage image, double x, double y) {
        return image.getRGB((int) (x * ShareFrames.SCALE), (int) (y * ShareFrames.SCALE));
    }

    private static int alpha(BufferedImage image, double x, double y) { return argb(image, x, y) >>> 24; }

    private static BufferedImage solid(int width, int height, Color color) {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        g.setColor(color);
        g.fillRect(0, 0, width, height);
        g.dispose();
        return image;
    }
}
