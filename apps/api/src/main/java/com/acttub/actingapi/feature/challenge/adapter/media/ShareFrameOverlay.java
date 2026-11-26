package com.acttub.actingapi.feature.challenge.adapter.media;

import java.awt.AlphaComposite;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.FontFormatException;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.Shape;
import java.awt.font.FontRenderContext;
import java.awt.font.TextAttribute;
import java.awt.geom.AffineTransform;
import java.awt.geom.Area;
import java.awt.geom.Ellipse2D;
import java.awt.geom.Path2D;
import java.awt.geom.Rectangle2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.List;
import java.util.Map;
import javax.imageio.ImageIO;
import com.acttub.actingapi.feature.challenge.domain.ShareFrames;
import com.acttub.actingapi.feature.challenge.domain.ShareFrames.Card;
import com.acttub.actingapi.feature.challenge.domain.ShareFrames.Palette;
import com.acttub.actingapi.feature.challenge.domain.ShareFrames.Rect;

/**
 * 공유 프레임의 틀 그림 (challenge.entry 공유 프레임, SOMA-1156). 영상 창 자리만 투명하게 뚫고 나머지(배경·필름 구멍·머리줄·
 * 배지·클래퍼·REC·대사·워드마크·도장)를 그린다. 자리와 색은 {@link ShareFrames} 가 정하고 여기는 Java2D 로 그리기만 한다.
 * 글꼴은 Pretendard(OFL, 라이선스는 같은 자리의 {@code OFL.txt}, 앱과 같은 subset)이고 800 굵기는 Bold 로 대신한다. 서브셋에
 * 없는 글자는 {@link #displayable} 이 뺀다.
 */
final class ShareFrameOverlay {
    private static final int DARK = 0xFF191F28;
    private static final int REC_RED = 0xFFE42939;
    private static final int REC_BACKGROUND = 0x8C000000;
    private static final Font BOLD = font("Pretendard-Bold.subset.ttf");
    private static final Font SEMIBOLD = font("Pretendard-SemiBold.subset.ttf");
    private static final BufferedImage WORDMARK = image("logo-wordmark.png");
    private static final BufferedImage WORDMARK_WHITE = tint(WORDMARK, 0xFFFFFF);
    /** 워드마크 그림 왼쪽의 투명한 여백(그림 픽셀) — 글자 왼쪽 끝을 안쪽 여백에 맞춘다. */
    private static final int WORDMARK_LEFT = leftInset(WORDMARK);
    private static final FontRenderContext MEASURE = new FontRenderContext(null, true, true);

    private ShareFrameOverlay() { }

    /** 틀 그림. 크기는 405×720 × {@code scale}(반올림)이고 ARGB 다. */
    static BufferedImage draw(Card card, double scale) {
        int width = (int) Math.round(ShareFrames.WIDTH * scale);
        int height = (int) Math.round(ShareFrames.HEIGHT * scale);
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        try {
            quality(g);
            g.scale(scale, scale);
            Palette palette = card.frame().palette();
            background(g, palette);
            perforations(g, palette);
            header(g, card, palette);
            badge(g, card, palette);
            rec(g);
            slate(g, card);
            line(g, card, palette);
            footer(g, palette);
            stamp(g, card, palette);
        } finally {
            g.dispose();
        }
        return image;
    }

    /** 대사 줄 나누기에 쓰는 폭(설계 좌표). */
    static double lineWidth(String text) { return width(BOLD.deriveFont(16f), text); }

    static void quality(Graphics2D g) {
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_FRACTIONALMETRICS, RenderingHints.VALUE_FRACTIONALMETRICS_ON);
        g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
    }

    private static void background(Graphics2D g, Palette palette) {
        Area area = new Area(new Rectangle2D.Double(0, 0, ShareFrames.WIDTH, ShareFrames.HEIGHT));
        area.subtract(new Area(window()));
        g.setColor(color(palette.background()));
        g.fill(area);
    }

    static Shape window() {
        Rect w = ShareFrames.WINDOW;
        double arc = ShareFrames.WINDOW_RADIUS * 2;
        return new RoundRectangle2D.Double(w.x(), w.y(), w.width(), w.height(), arc, arc);
    }

    private static void perforations(Graphics2D g, Palette palette) {
        g.setColor(color(palette.perforation()));
        for (Rect hole : ShareFrames.perforations()) {
            g.fill(round(hole, 2));
            g.fill(round(ShareFrames.mirror(hole), 2));
        }
    }

    private static void header(Graphics2D g, Card card, Palette palette) {
        Font label = BOLD.deriveFont(Map.of(TextAttribute.SIZE, 11f, TextAttribute.TRACKING, 1f / 11));
        text(g, label, ShareFrames.LABEL, ShareFrames.PAD, top(label, ShareFrames.LABEL_BOX), palette.label());
        Font title = BOLD.deriveFont(24f);
        text(g, title, card.title(), ShareFrames.PAD, top(title, ShareFrames.TITLE_BOX), palette.title());
    }

    /** 머리줄 오른쪽의 #N 알약. 회원 챌린지는 없다. */
    private static void badge(Graphics2D g, Card card, Palette palette) {
        if (card.badge() == null) return;
        Font font = BOLD.deriveFont(14f);
        double w = width(font, card.badge()) + 20;
        double h = 26;
        double cx = ShareFrames.PAD + ShareFrames.INNER_WIDTH - w / 2;
        double cy = ShareFrames.TITLE_BOX.y() + ShareFrames.TITLE_BOX.height() / 2;
        AffineTransform saved = g.getTransform();
        g.rotate(Math.toRadians(ShareFrames.BADGE_ANGLE), cx, cy);
        g.setColor(color(palette.badgeBackground()));
        g.fill(new RoundRectangle2D.Double(cx - w / 2, cy - h / 2, w, h, h, h));
        text(g, font, card.badge(), cx - width(font, card.badge()) / 2, middle(font, cy), palette.badgeText());
        g.setTransform(saved);
    }

    /** 창 오른쪽 위의 REC 표지(반투명 검정 바탕). */
    private static void rec(Graphics2D g) {
        Font font = BOLD.deriveFont(11f);
        double textWidth = width(font, ShareFrames.REC);
        double w = 8 + 6 + 5 + textWidth + 8;
        double h = ShareFrames.REC_HEIGHT;
        double x = ShareFrames.WINDOW.right() - ShareFrames.REC_INSET - w;
        double y = ShareFrames.WINDOW.y() + ShareFrames.REC_INSET;
        g.setColor(color(REC_BACKGROUND));
        g.fill(new RoundRectangle2D.Double(x, y, w, h, 8, 8));
        g.setColor(color(REC_RED));
        g.fill(new Ellipse2D.Double(x + 8, y + h / 2 - 3, 6, 6));
        text(g, font, ShareFrames.REC, x + 19, middle(font, y + h / 2), 0xFFFFFFFF);
    }

    /** 창 왼쪽 위 모서리에 걸친 클래퍼: 줄무늬 윗막대와 SCENE N · TAKE 1(회원 챌린지는 TAKE 1 만)을 적은 검은 몸통. */
    private static void slate(Graphics2D g, Card card) {
        Rect s = ShareFrames.SLATE;
        AffineTransform saved = g.getTransform();
        g.rotate(Math.toRadians(ShareFrames.SLATE_ANGLE), s.x() + s.width() / 2, s.y() + s.height() / 2);
        double bar = ShareFrames.SLATE_BAR;
        g.setColor(color(DARK));
        g.fill(new RoundRectangle2D.Double(s.x(), s.y() + bar - 2, s.width(), s.height() - bar + 2, 6, 6));
        Shape top = new Rectangle2D.Double(s.x(), s.y(), s.width(), bar);
        g.setColor(Color.WHITE);
        g.fill(top);
        Shape clip = g.getClip();
        g.clip(top);
        g.setColor(color(DARK));
        for (double x = s.x() - bar; x < s.right(); x += 12) {
            Path2D stripe = new Path2D.Double();
            stripe.moveTo(x, s.y() + bar);
            stripe.lineTo(x + 6, s.y() + bar);
            stripe.lineTo(x + 6 + bar, s.y());
            stripe.lineTo(x + bar, s.y());
            stripe.closePath();
            g.fill(stripe);
        }
        g.setClip(clip);
        g.setStroke(new BasicStroke(2));
        g.draw(new Rectangle2D.Double(s.x() + 1, s.y() + 1, s.width() - 2, bar - 1));
        Font font = BOLD.deriveFont(8f);
        if (card.scene() != null) {
            text(g, font, card.scene(), s.x() + 7, s.y() + bar + 4, 0xFFFFFFFF);
            text(g, font, ShareFrames.TAKE, s.x() + 7, s.y() + bar + 15, 0xFFFFFFFF);
        } else {
            text(g, font, ShareFrames.TAKE, s.x() + 7, s.y() + bar + (s.height() - bar - height(font)) / 2, 0xFFFFFFFF);
        }
        g.setTransform(saved);
    }

    /** 창 아래 대사. 따옴표는 강조색이고 가운데 맞춤이다. */
    private static void line(Graphics2D g, Card card, Palette palette) {
        Font font = BOLD.deriveFont(16f);
        List<String> lines = ShareFrames.quotedLines(displayable(card.line()), ShareFrameOverlay::lineWidth);
        double center = ShareFrames.WIDTH / 2;
        for (int i = 0; i < lines.size(); i++) {
            String text = lines.get(i);
            double y = ShareFrames.LINE_TOP + i * ShareFrames.LINE_HEIGHT;
            double top = y + (ShareFrames.LINE_HEIGHT - height(font)) / 2;
            double x = center - width(font, text) / 2;
            String open = text.startsWith(ShareFrames.OPEN_QUOTE) ? ShareFrames.OPEN_QUOTE : "";
            String close = text.endsWith(ShareFrames.CLOSE_QUOTE) ? ShareFrames.CLOSE_QUOTE : "";
            String body = text.substring(open.length(), text.length() - close.length());
            text(g, font, open, x, top, palette.quote());
            x += width(font, open);
            text(g, font, body, x, top, palette.lineText());
            x += width(font, body);
            text(g, font, close, x, top, palette.quote());
        }
    }

    private static void footer(Graphics2D g, Palette palette) {
        BufferedImage mark = palette.whiteWordmark() ? WORDMARK_WHITE : WORDMARK;
        double h = ShareFrames.WORDMARK_HEIGHT;
        double w = h * mark.getWidth() / mark.getHeight();
        double x = ShareFrames.PAD - WORDMARK_LEFT * h / mark.getHeight();
        AffineTransform saved = g.getTransform();
        g.translate(x, ShareFrames.WORDMARK_TOP);
        g.scale(w / mark.getWidth(), h / mark.getHeight());
        g.drawImage(mark, 0, 0, null);
        g.setTransform(saved);
        Font font = SEMIBOLD.deriveFont(12f);
        text(g, font, ShareFrames.FOOTER, ShareFrames.PAD, top(font, ShareFrames.FOOTER_TEXT_BOX), palette.footerText());
    }

    /** 오른쪽 아래 도장: 이름과 참여한 날. */
    private static void stamp(Graphics2D g, Card card, Palette palette) {
        Font font = BOLD.deriveFont(10f);
        String name = ShareFrames.fitOneLine(displayable(card.name()), ShareFrames.STAMP_TEXT_MAX, text -> width(font, text));
        double w = Math.max(width(font, name), width(font, card.date())) + 16;
        double h = 13 * 2 + 12;
        double x = ShareFrames.PAD + ShareFrames.INNER_WIDTH - w;
        double y = ShareFrames.FOOTER_BOTTOM - h;
        AffineTransform saved = g.getTransform();
        g.rotate(Math.toRadians(ShareFrames.STAMP_ANGLE), x + w / 2, y + h / 2);
        g.setColor(color(palette.stamp()));
        g.setStroke(new BasicStroke(2));
        g.draw(new RoundRectangle2D.Double(x + 1, y + 1, w - 2, h - 2, 16, 16));
        text(g, font, name, x + (w - width(font, name)) / 2, y + 6 + (13 - height(font)) / 2, palette.stamp());
        text(g, font, card.date(), x + (w - width(font, card.date())) / 2, y + 19 + (13 - height(font)) / 2, palette.stamp());
        g.setTransform(saved);
    }

    /**
     * 사람이 적은 글(대사·이름)에서 실은 글꼴에 없는 글자를 뺀다. 실은 Pretendard 는 앱과 같은 서브셋(한글은 KS X 1001 2,350자 ∪
     * 흔한 받침 조합 5,749자, 한자·이모지 없음)이라 없는 글자를 그리면 네모가 찍힌다. 저장소에 전체 글꼴이 없어 대신 그릴 글꼴이
     * 없으므로 빼고 그린다(challenge.entry 공유 프레임의 한계). 띄어쓰기·줄바꿈은 줄 나누기에 쓰므로 남긴다.
     */
    static String displayable(String text) {
        var out = new StringBuilder(text.length());
        text.codePoints().filter(cp -> Character.isWhitespace(cp) || BOLD.canDisplay(cp)).forEach(out::appendCodePoint);
        return out.toString();
    }

    /** 위 끝이 {@code top} 인 글자를 그린다(기준선은 글꼴의 ascent 만큼 아래). */
    private static void text(Graphics2D g, Font font, String text, double x, double top, int argb) {
        if (text.isEmpty()) return;
        g.setFont(font);
        g.setColor(color(argb));
        g.drawString(text, (float) x, (float) (top + font.getLineMetrics(text, MEASURE).getAscent()));
    }

    /** 상자 안에서 세로 가운데인 글자의 위 끝. */
    private static double top(Font font, Rect box) { return box.y() + (box.height() - height(font)) / 2; }

    private static double middle(Font font, double center) { return center - height(font) / 2; }

    private static double height(Font font) {
        var metrics = font.getLineMetrics("가A", MEASURE);
        return metrics.getAscent() + metrics.getDescent();
    }

    static double width(Font font, String text) {
        return text.isEmpty() ? 0 : font.getStringBounds(text, MEASURE).getWidth();
    }

    private static Shape round(Rect rect, double radius) {
        return new RoundRectangle2D.Double(rect.x(), rect.y(), rect.width(), rect.height(), radius * 2, radius * 2);
    }

    static Color color(int argb) { return new Color(argb, true); }

    private static Font font(String name) {
        try (InputStream in = resource(name)) {
            return Font.createFont(Font.TRUETYPE_FONT, in);
        } catch (IOException | FontFormatException failure) {
            throw new IllegalStateException("share frame font " + name, failure);
        }
    }

    private static BufferedImage image(String name) {
        try (InputStream in = resource(name)) {
            BufferedImage read = ImageIO.read(in);
            BufferedImage argb = new BufferedImage(read.getWidth(), read.getHeight(), BufferedImage.TYPE_INT_ARGB);
            Graphics2D g = argb.createGraphics();
            g.setComposite(AlphaComposite.Src);
            g.drawImage(read, 0, 0, null);
            g.dispose();
            return argb;
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        }
    }

    private static InputStream resource(String name) throws IOException {
        InputStream in = ShareFrameOverlay.class.getResourceAsStream("/share-frame/" + name);
        if (in == null) throw new IOException("missing resource /share-frame/" + name);
        return in;
    }

    /** 모양(알파)은 그대로 두고 색을 한 가지로 칠한다 — 파랑·검정 프레임의 흰 워드마크. */
    static BufferedImage tint(BufferedImage source, int rgb) {
        BufferedImage out = new BufferedImage(source.getWidth(), source.getHeight(), BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < source.getHeight(); y++) {
            for (int x = 0; x < source.getWidth(); x++) {
                out.setRGB(x, y, (source.getRGB(x, y) & 0xFF000000) | (rgb & 0xFFFFFF));
            }
        }
        return out;
    }

    private static int leftInset(BufferedImage image) {
        for (int x = 0; x < image.getWidth(); x++) {
            for (int y = 0; y < image.getHeight(); y++) {
                if ((image.getRGB(x, y) >>> 24) > 16) return x;
            }
        }
        return 0;
    }
}
