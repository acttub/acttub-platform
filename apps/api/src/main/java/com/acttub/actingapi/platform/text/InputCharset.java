package com.acttub.actingapi.platform.text;

import com.acttub.actingapi.platform.web.ApiException;
import java.text.Normalizer;

/**
 * 배우가 자유롭게 적는 글(코칭 답·댓글·신고 메모·이름 등)의 허용 글자 범위. 범위 밖 글자가 하나라도 있으면 받지 않는다.
 *
 * <p>10/27 운영에서 글자 위아래에 결합 기호를 수십 개씩 쌓은 글(자고 텍스트)이 코칭 답으로 들어왔다.
 * 영문·숫자·기본 기호(ASCII), 한글, 자주 쓰는 문장부호, 이모지만 허용하고 결합 기호·보이지 않는 글자·
 * 제어 문자·그 밖의 문자는 막는다. 앱({@code apps/mobile/lib/practice/readable-text.ts})도 같은 범위로 먼저 막는다.
 */
public final class InputCharset {
    private InputCharset() {
    }

    /** 클라이언트가 보는 오류 코드. 앱은 이 코드를 "읽을 수 없는 글자" 안내로 바꾼다. */
    public static final String ERROR_CODE = "unreadable_text";

    /** 대본처럼 여러 문자가 정상으로 들어오는 곳에서 허용하는 결합 기호 연속 상한. 한글·가나·한자·라틴 악센트는 1~2개면 충분하다. */
    public static final int MAX_COMBINING_RUN = 4;

    /**
     * 비어 있지 않은 글이면 허용 범위 안이어야 한다. 값이 없거나 공백뿐이면 그 칸의 필수·길이 규칙에 맡긴다.
     * 하나라도 범위 밖이면 400 {@code unreadable_text}.
     */
    public static void require(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank() && !readable(value)) throw new ApiException(400, "unreadable_text");
        }
    }

    /** {@link #require} 의 대본용: 문자 종류는 막지 않고 결합 기호·이모지 연결 글자·제어 문자를 쌓는 것만 막는다. */
    public static void requireNoStacking(String... values) {
        for (String value : values) {
            if (value != null && stacked(value)) throw new ApiException(400, "unreadable_text");
        }
    }

    /** 결합 기호가 {@link #MAX_COMBINING_RUN}개를 넘게 이어지거나, 줄바꿈·탭을 뺀 제어 문자가 섞였는지. */
    public static boolean stacked(String text) {
        if (text == null) return false;
        int run = 0;
        for (int i = 0; i < text.length(); ) {
            int c = text.codePointAt(i);
            i += Character.charCount(c);
            int type = Character.getType(c);
            if (type == Character.NON_SPACING_MARK || type == Character.ENCLOSING_MARK || c == 0x200D || c == 0xFE0E || c == 0xFE0F) {
                // 이모지 변형(FE0F)·연결(200D)은 이모지 하나에 1~2개씩 정상으로 붙는다. 이어 붙는 수만 센다.
                if (++run > MAX_COMBINING_RUN) return true;
            } else {
                run = 0;
            }
            if (type == Character.CONTROL && c != '\n' && c != '\r' && c != '\t') return true;
        }
        return false;
    }

    /** 허용 범위 글자로만 되어 있고, 보이는 글자가 하나 이상인지. */
    public static boolean readable(String text) {
        if (text == null) return false;
        // 맥에서 붙여 넣은 é(e + 결합 악센트) 같은 분해형은 합쳐서 본다.
        String value = Normalizer.normalize(text, Normalizer.Form.NFC);
        boolean visible = false;
        int previous = -1;
        for (int i = 0; i < value.length(); ) {
            int c = value.codePointAt(i);
            i += Character.charCount(c);
            if (!allowed(c, previous)) return false;
            if (!joiner(c) && !Character.isWhitespace(c) && c != 0x00A0 && c != 0x3000) visible = true;
            previous = c;
        }
        return visible;
    }

    private static boolean allowed(int c, int previous) {
        if (c == '\n' || c == '\r' || c == '\t') return true;
        if (c >= 0x20 && c <= 0x7E) return true;                 // ASCII 영문·숫자·기본 기호
        if (c >= 0xA0 && c <= 0xFF && c != 0xAD) return true;    // · × é 같은 라틴-1 (보이지 않는 하이픈 제외)
        if (c >= 0xAC00 && c <= 0xD7A3) return true;             // 한글 완성형
        if (c >= 0x1100 && c <= 0x11FF) return true;             // 한글 자모(분해형)
        if (c >= 0x3130 && c <= 0x318F) return true;             // 한글 호환 자모(ㅋㅋ, ㅠㅠ)
        if (c >= 0x2010 && c <= 0x2027) return true;             // – — ‘ ’ “ ” • …
        if (c >= 0x2030 && c <= 0x205E) return true;             // ‰ ′ ※ ‼ ⁉
        if (c >= 0x20A0 && c <= 0x20CF) return true;             // ₩ €
        if (c >= 0x2100 && c <= 0x23FF) return true;             // ℃ ™ 화살표 ⌚ ⏰
        if (c >= 0x2460 && c <= 0x27BF) return true;             // ① ■ ★ ♥ ✔
        if (c >= 0x2B00 && c <= 0x2BFF) return true;             // ⭐ ⬆
        if (c >= 0x3000 && c <= 0x303F) return true;             // 「」『』、。〜
        if (c >= 0x3200 && c <= 0x32FF) return true;             // ㈜ ㉠
        if (c >= 0xFF01 && c <= 0xFF60) return true;             // 전각 ！？～
        if (c >= 0xFFE0 && c <= 0xFFE6) return true;             // ￦
        if (c >= 0x1F000 && c <= 0x1FAFF) return true;           // 이모지·국기·피부색
        // 이모지를 잇는 글자는 앞 글자에 붙을 때만(❤️‍🔥처럼 FE0F 뒤 200D는 된다). 이것만 겹쳐 쌓는 것은 막는다.
        if (c == 0x200D || c == 0xFE0E || c == 0xFE0F) return previous >= 0 && previous != c && previous != 0x200D && previous != 0x20E3;
        if (c == 0x20E3) return previous == 0xFE0F || (previous >= '0' && previous <= '9') || previous == '#' || previous == '*';
        return false;
    }

    private static boolean joiner(int c) {
        return c == 0x200D || c == 0xFE0E || c == 0xFE0F || c == 0x20E3;
    }
}
