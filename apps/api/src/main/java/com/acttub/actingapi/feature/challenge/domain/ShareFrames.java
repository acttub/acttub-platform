package com.acttub.actingapi.feature.challenge.domain;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.ToDoubleFunction;

/**
 * 인스타 공유·영상 저장에 씌우는 9:16 프레임 (challenge.entry 공유 프레임, SOMA-1156). 405×720 설계 좌표로 자리를 정하고
 * 그리는 쪽이 {@link #SCALE} 배로 1080×1920 에 그린다. 글자 폭은 그리는 쪽의 글꼴이 재므로 줄바꿈은 폭 함수를 받는다.
 */
public final class ShareFrames {
    /** 바꾸면 이미 만든 프레임 영상을 쓰지 않고 새로 만든다(키에 들어간다). 그리는 모양을 바꿀 때 올린다. */
    public static final int VERSION = 1;
    public static final double WIDTH = 405;
    public static final double HEIGHT = 720;
    public static final int OUTPUT_WIDTH = 1080;
    public static final int OUTPUT_HEIGHT = 1920;
    public static final double SCALE = OUTPUT_WIDTH / WIDTH;
    /** 미리보기 그림의 폭. 높이는 9:16 이다. */
    public static final int PREVIEW_WIDTH = 540;
    public static final double PAD = 34;
    public static final double INNER_WIDTH = WIDTH - 2 * PAD;

    public static final String LABEL = "ACTTUB WEEKLY LINE";
    /** 기획팀 챌린지의 제목. 회원이 연 챌린지는 {@link #MEMBER_TITLE} 이다. */
    public static final String TITLE = "이번 주 대사 챌린지";
    public static final String MEMBER_TITLE = "대사 챌린지";
    public static final String FOOTER = "acttub.com에서 같이 연기해요";
    public static final String TAKE = "TAKE 1";
    public static final String REC = "REC";
    public static final String OPEN_QUOTE = "“";
    public static final String CLOSE_QUOTE = "”";
    public static final String ELLIPSIS = "…";

    /** 머리줄: 위 26 에서 작은 영문 표지(11)와 그 아래 제목(24). */
    public static final Rect LABEL_BOX = new Rect(PAD, 26, INNER_WIDTH, 14);
    public static final Rect TITLE_BOX = new Rect(PAD, 42, INNER_WIDTH, 30);
    /** 영상 창: 머리줄 아래 14, 안쪽 폭 전부, 높이 452, 모서리 6. 영상은 이 창을 꽉 채우게(가운데 잘라) 놓는다. */
    public static final Rect WINDOW = new Rect(PAD, 86, INNER_WIDTH, 452);
    public static final double WINDOW_RADIUS = 6;
    /** 클래퍼 스티커: 창의 왼쪽 위 모서리에 걸친다(왼쪽 -12, 위 -14, 폭 62, -10° 기울임). */
    public static final Rect SLATE = new Rect(WINDOW.x() - 12, WINDOW.y() - 14, 62, 40);
    public static final double SLATE_BAR = 12;
    public static final double SLATE_ANGLE = -10;
    /** REC 표지: 창 오른쪽 위에서 10 안쪽. */
    public static final double REC_INSET = 10;
    public static final double REC_HEIGHT = 20;
    /** 회차 배지: 머리줄 오른쪽, +4° 기울임. */
    public static final double BADGE_ANGLE = 4;
    /** 대사: 창 아래 18, 16pt·줄 높이 1.5, 세 줄까지. */
    public static final double LINE_TOP = WINDOW.bottom() + 18;
    public static final double LINE_HEIGHT = 24;
    public static final int LINE_MAX = 3;
    /** 바닥줄: 아래 26 위에 워드마크(높이 26)와 그 아래 안내 한 줄(12). */
    public static final double FOOTER_BOTTOM = HEIGHT - 26;
    public static final double WORDMARK_HEIGHT = 26;
    public static final Rect FOOTER_TEXT_BOX = new Rect(PAD, FOOTER_BOTTOM - 16, INNER_WIDTH, 16);
    public static final double WORDMARK_TOP = FOOTER_TEXT_BOX.y() - 6 - WORDMARK_HEIGHT;
    /** 도장: 오른쪽 아래, -6° 기울임. 이름이 길면 이 폭에서 자른다. */
    public static final double STAMP_ANGLE = -6;
    public static final double STAMP_TEXT_MAX = 90;
    /** 필름 구멍: 양옆 6 안쪽에 9×13 둥근 칸 18개를 고르게. */
    public static final int PERFORATIONS = 18;
    public static final double PERFORATION_WIDTH = 9;
    public static final double PERFORATION_HEIGHT = 13;
    public static final double PERFORATION_INSET = 6;

    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final DateTimeFormatter STAMP_DATE = DateTimeFormatter.ofPattern("yyyy.MM.dd");

    private ShareFrames() { }

    public record Rect(double x, double y, double width, double height) {
        public double right() { return x + width; }
        public double bottom() { return y + height; }

        /**
         * 출력 픽셀로 옮긴다 — {x, y, 폭, 높이}. ffmpeg 의 크기·자리는 짝수여야 하므로 바깥쪽 짝수로 넓힌다. 넓힌 가장자리는
         * 틀 그림이 덮으므로 창 안에 빈 줄이 생기지 않는다.
         */
        public int[] pixels(double scale) {
            int left = (int) Math.floor(x * scale) & ~1;
            int top = (int) Math.floor(y * scale) & ~1;
            int right = ((int) Math.ceil(right() * scale) + 1) & ~1;
            int bottom = ((int) Math.ceil(bottom() * scale) + 1) & ~1;
            return new int[] {left, top, right - left, bottom - top};
        }
    }

    /**
     * 색 한 벌. 값은 ARGB 다. {@code whiteWordmark} 면 워드마크를 흰색 한 가지로 칠한다.
     */
    public record Palette(int background, int perforation, int label, int title, int badgeBackground, int badgeText,
                          int quote, int lineText, int footerText, int stamp, boolean whiteWordmark) { }

    public enum Frame {
        WHITE("white", new Palette(0xFFFFFFFF, 0xFFE5E8EB, 0xFF3268D8, 0xFF191F28, 0xFF4880EE, 0xFFFFFFFF,
                0xFF4880EE, 0xFF191F28, 0xFF4E5968, 0xFF3268D8, false)),
        BLUE("blue", new Palette(0xFF4880EE, 0x59FFFFFF, 0xFFEAF3FE, 0xFFFFFFFF, 0xFFFFFFFF, 0xFF3268D8,
                0xFFEAF3FE, 0xFFFFFFFF, 0xFFEAF3FE, 0xFFFFFFFF, true)),
        BLACK("black", new Palette(0xFF111318, 0xFF2A2D35, 0xFF96ACFF, 0xFFFFFFFF, 0xFF4880EE, 0xFFFFFFFF,
                0xFF96ACFF, 0xFFFFFFFF, 0xFFB0B8C1, 0xFF96ACFF, true));

        private final String id;
        private final Palette palette;

        Frame(String id, Palette palette) { this.id = id; this.palette = palette; }

        public String id() { return id; }
        public Palette palette() { return palette; }

        /** 요청의 값(white·blue·black). 모르는 값이면 {@code null}. */
        public static Frame of(String id) {
            for (Frame frame : values()) if (frame.id.equals(id)) return frame;
            return null;
        }
    }

    /**
     * 프레임에 들어갈 글자. {@code number} 는 기획팀 챌린지의 회차(배지의 #N 과 클래퍼의 SCENE N)이고, 회원이 연 챌린지는 null
     * 이다 — 제목은 「대사 챌린지」, 배지는 없고 클래퍼는 TAKE 1 만 적는다. {@code frame} 이 null 이면 「없음」 미리보기다.
     */
    public record Card(Frame frame, String line, Integer number, String name, String date) {
        public boolean official() { return number != null; }
        public String title() { return official() ? TITLE : MEMBER_TITLE; }
        /** 머리줄 오른쪽 배지. 회원 챌린지는 null(그리지 않는다). */
        public String badge() { return official() ? "#" + number : null; }
        /** 클래퍼 윗줄. 회원 챌린지는 null(TAKE 1 만 적는다). */
        public String scene() { return official() ? "SCENE " + number : null; }
    }

    /** 도장의 날짜 — 참여한 날을 한국 날짜로. */
    public static String stampDate(Instant createdAt) {
        return STAMP_DATE.format(createdAt.atZone(SEOUL));
    }

    /** 필름 구멍 한 줄(왼쪽). 오른쪽은 {@link #mirror} 로 옮긴다. */
    public static List<Rect> perforations() {
        double step = HEIGHT / PERFORATIONS;
        var out = new ArrayList<Rect>();
        for (int i = 0; i < PERFORATIONS; i++) {
            out.add(new Rect(PERFORATION_INSET, step * i + (step - PERFORATION_HEIGHT) / 2, PERFORATION_WIDTH, PERFORATION_HEIGHT));
        }
        return out;
    }

    public static Rect mirror(Rect rect) {
        return new Rect(WIDTH - rect.x() - rect.width(), rect.y(), rect.width(), rect.height());
    }

    /**
     * 프레임 영상의 키 — 원본 옆 {@code videos/{사용자}/{요청}.frame-{참여작}-{프레임}-{원본|모자이크}-v{판}.mp4}. 어느 영상에서
     * 만들었는지와 판이 키에 들어가므로 모자이크 상태가 바뀌거나 모양을 고치면 다른 키가 된다.
     */
    public static String videoKey(String objectKey, UUID entryId, Frame frame, boolean mosaic) {
        return base(objectKey, entryId, frame, mosaic) + ".mp4";
    }

    /**
     * 미리보기 그림(JPEG)의 키. 프레임 영상과 같은 자리에 확장자만 다르다. {@code frame} 이 null 이면 「없음」(틀 없이 장면만)이다.
     */
    public static String previewKey(String objectKey, UUID entryId, Frame frame, boolean mosaic) {
        return base(objectKey, entryId, frame, mosaic) + ".jpg";
    }

    /** 미리보기에서 틀 없이 장면만 보이는 「없음」의 값. 영상은 원본 그대로 나가므로 프레임 영상에는 쓰지 않는다. */
    public static final String NONE = "none";

    private static String base(String objectKey, UUID entryId, Frame frame, boolean mosaic) {
        int dot = objectKey.lastIndexOf('.');
        int slash = objectKey.lastIndexOf('/');
        return (dot > slash ? objectKey.substring(0, dot) : objectKey) + ".frame-" + entryId + "-"
                + (frame == null ? NONE : frame.id()) + "-" + (mosaic ? "mosaic" : "original") + "-v" + VERSION;
    }

    /**
     * 꽉 채우기(가운데 자르기) — {@code sourceWidth×sourceHeight} 그림에서 {@code width×height} 상자와 같은 비율로 가운데를 잘라 낸
     * 부분. ffmpeg 의 {@code scale=…:force_original_aspect_ratio=increase,crop=…} 와 같다. @return {x, y, 폭, 높이}(원본 픽셀)
     */
    public static double[] coverCrop(int sourceWidth, int sourceHeight, double width, double height) {
        double scale = Math.max(width / sourceWidth, height / sourceHeight);
        double w = width / scale;
        double h = height / scale;
        return new double[] {(sourceWidth - w) / 2, (sourceHeight - h) / 2, w, h};
    }

    /**
     * 대사를 따옴표로 감싸 창 폭에 맞게 줄을 나눈다. 대사 안의 줄바꿈은 지키고, 세 줄을 넘으면 셋째 줄 끝을 "…”" 로 닫는다.
     */
    public static List<String> quotedLines(String line, ToDoubleFunction<String> width) {
        return wrap(OPEN_QUOTE + line.strip() + CLOSE_QUOTE, INNER_WIDTH, LINE_MAX, width, ELLIPSIS + CLOSE_QUOTE);
    }

    /**
     * 글을 {@code maxWidth} 안에 들어가게 나눈다. 띄어쓰기 단위로 나누고, 한 어절이 한 줄보다 길면 글자 단위로 자른다. 줄바꿈은
     * 지키고 빈 줄은 버린다. {@code maxLines} 를 넘으면 마지막 줄 끝을 {@code ellipsis} 로 바꾼다(들어갈 때까지 글자를 뺀다).
     */
    public static List<String> wrap(String text, double maxWidth, int maxLines, ToDoubleFunction<String> width, String ellipsis) {
        var lines = new ArrayList<String>();
        for (String paragraph : text.split("\\R")) {
            String words = paragraph.replaceAll("[\\s\\u00A0\\uFEFF]+", " ").strip();
            if (words.isEmpty()) continue;
            String current = "";
            for (String word : words.split(" ")) {
                String joined = current.isEmpty() ? word : current + " " + word;
                if (width.applyAsDouble(joined) <= maxWidth) {
                    current = joined;
                    continue;
                }
                if (!current.isEmpty()) lines.add(current);
                current = word;
                // 한 어절이 한 줄보다 길면 글자 단위로 끊는다.
                while (width.applyAsDouble(current) > maxWidth) {
                    int cut = fit(current, maxWidth, width);
                    lines.add(current.substring(0, cut));
                    current = current.substring(cut);
                }
            }
            if (!current.isEmpty()) lines.add(current);
        }
        if (lines.size() <= maxLines) return lines;
        var kept = new ArrayList<>(lines.subList(0, maxLines));
        String last = kept.get(maxLines - 1);
        while (!last.isEmpty() && width.applyAsDouble(last.strip() + ellipsis) > maxWidth) {
            last = last.substring(0, last.offsetByCodePoints(last.length(), -1));
        }
        kept.set(maxLines - 1, last.strip() + ellipsis);
        return kept;
    }

    /** {@code maxWidth} 안에 들어가는 가장 긴 앞부분의 길이(char). 적어도 한 글자. */
    private static int fit(String text, double maxWidth, ToDoubleFunction<String> width) {
        int end = text.offsetByCodePoints(0, 1);
        while (end < text.length()) {
            int next = text.offsetByCodePoints(end, 1);
            if (width.applyAsDouble(text.substring(0, next)) > maxWidth) break;
            end = next;
        }
        return end;
    }

    /** 한 줄 글자를 {@code maxWidth} 에 맞춘다. 넘으면 끝을 "…" 로 줄인다(도장의 이름). */
    public static String fitOneLine(String text, double maxWidth, ToDoubleFunction<String> width) {
        List<String> lines = wrap(text, maxWidth, 1, width, ELLIPSIS);
        return lines.isEmpty() ? "" : lines.getFirst();
    }
}
