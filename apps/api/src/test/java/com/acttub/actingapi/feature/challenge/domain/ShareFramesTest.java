package com.acttub.actingapi.feature.challenge.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.function.ToDoubleFunction;
import com.acttub.actingapi.feature.challenge.domain.ShareFrames.Frame;
import com.acttub.actingapi.feature.challenge.domain.ShareFrames.Rect;
import org.junit.jupiter.api.Test;

/** 공유 프레임의 자리·색·키·줄바꿈 (challenge.entry 공유 프레임, SOMA-1156). */
class ShareFramesTest {
    /** 글자마다 폭 10 — 줄바꿈을 글꼴 없이 본다. */
    private static final ToDoubleFunction<String> TEN = text -> text.codePointCount(0, text.length()) * 10.0;

    @Test void theFrameIsNineBySixteenAndScalesToTenEightyByNineteenTwenty() {
        assertThat(ShareFrames.WIDTH * ShareFrames.SCALE).isEqualTo(1080.0);
        assertThat(ShareFrames.HEIGHT * ShareFrames.SCALE).isEqualTo(1920.0);
        assertThat(ShareFrames.INNER_WIDTH).isEqualTo(337.0);
    }

    @Test void theWindowSitsUnderTheHeaderAndAboveTheLineAndFooter() {
        Rect window = ShareFrames.WINDOW;
        assertThat(window.x()).isEqualTo(34.0);
        assertThat(window.width()).isEqualTo(337.0);
        assertThat(window.height()).isEqualTo(452.0);
        assertThat(window.y()).isEqualTo(ShareFrames.TITLE_BOX.bottom() + 14);
        assertThat(ShareFrames.LINE_TOP).isEqualTo(window.bottom() + 18);
        double lineBottom = ShareFrames.LINE_TOP + ShareFrames.LINE_MAX * ShareFrames.LINE_HEIGHT;
        assertThat(lineBottom).isLessThanOrEqualTo(ShareFrames.WORDMARK_TOP);
        assertThat(ShareFrames.FOOTER_TEXT_BOX.bottom()).isEqualTo(720.0 - 26);
        assertThat(ShareFrames.SLATE.x()).isEqualTo(window.x() - 12);
        assertThat(ShareFrames.SLATE.y()).isEqualTo(window.y() - 14);
        assertThat(ShareFrames.SLATE.width()).isEqualTo(62.0);
    }

    @Test void windowPixelsAreEvenAndCoverTheExactWindow() {
        int[] px = ShareFrames.WINDOW.pixels(ShareFrames.SCALE);
        for (int value : px) assertThat(value % 2).isZero();
        Rect w = ShareFrames.WINDOW;
        assertThat((double) px[0]).isLessThanOrEqualTo(w.x() * ShareFrames.SCALE);
        assertThat((double) px[1]).isLessThanOrEqualTo(w.y() * ShareFrames.SCALE);
        assertThat((double) px[0] + px[2]).isGreaterThanOrEqualTo(w.right() * ShareFrames.SCALE);
        assertThat((double) px[1] + px[3]).isGreaterThanOrEqualTo(w.bottom() * ShareFrames.SCALE);
        assertThat(px[2]).isLessThanOrEqualTo((int) Math.ceil(w.width() * ShareFrames.SCALE) + 4);
    }

    @Test void eighteenPerforationsRunEvenlyDownEachSideSixFromTheEdge() {
        List<Rect> holes = ShareFrames.perforations();
        assertThat(holes).hasSize(18);
        assertThat(holes.getFirst().x()).isEqualTo(6.0);
        assertThat(holes.getFirst().width()).isEqualTo(9.0);
        assertThat(holes.getFirst().height()).isEqualTo(13.0);
        assertThat(holes.get(1).y() - holes.get(0).y()).isEqualTo(40.0);
        assertThat(holes.getLast().bottom()).isLessThan(720.0);
        assertThat(ShareFrames.mirror(holes.getFirst()).right()).isEqualTo(405.0 - 6);
    }

    @Test void eachFrameHasItsOwnPalette() {
        assertThat(Frame.WHITE.palette().background()).isEqualTo(0xFFFFFFFF);
        assertThat(Frame.WHITE.palette().title()).isEqualTo(0xFF191F28);
        assertThat(Frame.WHITE.palette().quote()).isEqualTo(0xFF4880EE);
        assertThat(Frame.WHITE.palette().whiteWordmark()).isFalse();
        assertThat(Frame.BLUE.palette().background()).isEqualTo(0xFF4880EE);
        assertThat(Frame.BLUE.palette().perforation()).isEqualTo(0x59FFFFFF);
        assertThat(Frame.BLUE.palette().badgeBackground()).isEqualTo(0xFFFFFFFF);
        assertThat(Frame.BLUE.palette().badgeText()).isEqualTo(0xFF3268D8);
        assertThat(Frame.BLUE.palette().whiteWordmark()).isTrue();
        assertThat(Frame.BLACK.palette().background()).isEqualTo(0xFF111318);
        assertThat(Frame.BLACK.palette().label()).isEqualTo(0xFF96ACFF);
        assertThat(Frame.BLACK.palette().footerText()).isEqualTo(0xFFB0B8C1);
        assertThat(Frame.BLACK.palette().whiteWordmark()).isTrue();
    }

    @Test void framesAreReadByTheirLowercaseNameOnly() {
        assertThat(Frame.of("white")).isEqualTo(Frame.WHITE);
        assertThat(Frame.of("blue")).isEqualTo(Frame.BLUE);
        assertThat(Frame.of("black")).isEqualTo(Frame.BLACK);
        assertThat(Frame.of("none")).isNull();
        assertThat(Frame.of("WHITE")).isNull();
        assertThat(Frame.of(null)).isNull();
    }

    @Test void keysSitNextToTheOriginalAndCarryFrameSourceAndVersion() {
        UUID entry = UUID.fromString("00000000-0000-0000-0000-000000000001");
        assertThat(ShareFrames.videoKey("videos/u/r.mp4", entry, Frame.BLUE, false))
                .isEqualTo("videos/u/r.frame-" + entry + "-blue-original-v" + ShareFrames.VERSION + ".mp4");
        assertThat(ShareFrames.videoKey("videos/u/r", entry, Frame.WHITE, true))
                .isEqualTo("videos/u/r.frame-" + entry + "-white-mosaic-v" + ShareFrames.VERSION + ".mp4");
        assertThat(ShareFrames.previewKey("videos/u.d/r.mov", entry, Frame.BLACK, false))
                .isEqualTo("videos/u.d/r.frame-" + entry + "-black-original-v" + ShareFrames.VERSION + ".jpg");
        assertThat(ShareFrames.previewKey("videos/u/r.mp4", entry, null, false))
                .isEqualTo("videos/u/r.frame-" + entry + "-none-original-v" + ShareFrames.VERSION + ".jpg");
    }

    @Test void theStampDateIsTheKoreanDate() {
        assertThat(ShareFrames.stampDate(Instant.parse("2026-11-01T15:30:00Z"))).isEqualTo("2026.11.02");
        assertThat(ShareFrames.stampDate(Instant.parse("2026-11-01T14:59:59Z"))).isEqualTo("2026.11.01");
    }

    @Test void cardCarriesTheBadgeAndScene() {
        var card = new ShareFrames.Card(Frame.WHITE, "대사", 7, "배우", "2026.11.02");
        assertThat(card.badge()).isEqualTo("#7");
        assertThat(card.scene()).isEqualTo("SCENE 7");
        assertThat(card.title()).isEqualTo("이번 주 대사 챌린지");
    }

    @Test void aMemberChallengeCardHasThePlainTitleAndNoEpisode() {
        var card = new ShareFrames.Card(Frame.WHITE, "대사", null, "배우", "2026.11.02");
        assertThat(card.official()).isFalse();
        assertThat(card.title()).isEqualTo("대사 챌린지");
        assertThat(card.badge()).isNull();
        assertThat(card.scene()).isNull();
    }

    @Test void wrapBreaksAtSpacesKeepsNewlinesAndDropsBlankLines() {
        assertThat(ShareFrames.wrap("가나 다라 마바", 50, 3, TEN, "…")).containsExactly("가나 다라", "마바");
        assertThat(ShareFrames.wrap("가나\n\n  다라  ", 100, 3, TEN, "…")).containsExactly("가나", "다라");
        assertThat(ShareFrames.wrap("   ", 100, 3, TEN, "…")).isEmpty();
    }

    @Test void wrapCutsAWordLongerThanALineByCharacters() {
        assertThat(ShareFrames.wrap("가나다라마바사", 30, 3, TEN, "…")).containsExactly("가나다", "라마바", "사");
    }

    @Test void wrapClosesTheLastLineWithTheEllipsisWhenItOverflows() {
        List<String> lines = ShareFrames.wrap("가나다 라마바 사아자 차카타 파하", 30, 3, TEN, "…”");
        assertThat(lines).hasSize(3);
        assertThat(lines.get(0)).isEqualTo("가나다");
        assertThat(lines.get(1)).isEqualTo("라마바");
        assertThat(lines.get(2)).isEqualTo("사…”");
        for (String line : lines) assertThat(TEN.applyAsDouble(line)).isLessThanOrEqualTo(30);
    }

    @Test void quotedLinesWrapTheLineInQuotesWithinTheInnerWidth() {
        List<String> shortLine = ShareFrames.quotedLines("괜찮아", TEN);
        assertThat(shortLine).containsExactly("“괜찮아”");
        String longLine = "가".repeat(200);
        List<String> lines = ShareFrames.quotedLines(longLine, TEN);
        assertThat(lines).hasSize(3);
        assertThat(lines.getFirst()).startsWith("“");
        assertThat(lines.getLast()).endsWith("…”");
        for (String line : lines) assertThat(TEN.applyAsDouble(line)).isLessThanOrEqualTo(ShareFrames.INNER_WIDTH);
    }

    @Test void fitOneLineShortensALongName() {
        assertThat(ShareFrames.fitOneLine("WooYoung", ShareFrames.STAMP_TEXT_MAX, TEN)).isEqualTo("WooYoung");
        String fitted = ShareFrames.fitOneLine("아주아주긴이름을가진배우의이름입니다", ShareFrames.STAMP_TEXT_MAX, TEN);
        assertThat(fitted).endsWith("…");
        assertThat(TEN.applyAsDouble(fitted)).isLessThanOrEqualTo(ShareFrames.STAMP_TEXT_MAX);
    }

    @Test void coverCropTakesTheCentreAtTheBoxRatio() {
        // 가로 영상을 세로 창에: 가운데 세로 띠
        double[] wide = ShareFrames.coverCrop(1920, 1080, 337, 452);
        assertThat(wide[3]).isEqualTo(1080.0);
        assertThat(wide[2] / wide[3]).isCloseTo(337.0 / 452, org.assertj.core.data.Offset.offset(1e-9));
        assertThat(wide[0]).isCloseTo((1920 - wide[2]) / 2, org.assertj.core.data.Offset.offset(1e-9));
        assertThat(wide[1]).isZero();
        // 9:16 세로 영상을 창에: 위아래를 조금 자른다
        double[] tall = ShareFrames.coverCrop(1080, 1920, 337, 452);
        assertThat(tall[2]).isEqualTo(1080.0);
        assertThat(tall[1]).isPositive();
    }
}
