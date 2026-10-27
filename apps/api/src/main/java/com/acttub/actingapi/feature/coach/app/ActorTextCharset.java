package com.acttub.actingapi.feature.coach.app;

import java.text.Normalizer;

/**
 * 배우가 코칭에 쓰는 말의 허용 글자 범위. 범위 밖 글자가 하나라도 있으면 받지 않는다.
 *
 * <p>10/27 운영에서 글자 위아래에 결합 기호를 수십 개씩 쌓은 글(자고 텍스트)이 코칭 답으로 들어왔다.
 * 영문·숫자·기본 기호(ASCII), 한글, 자주 쓰는 문장부호, 이모지만 허용하고 결합 기호·보이지 않는 글자·
 * 제어 문자·그 밖의 문자는 막는다. 앱({@code apps/mobile/lib/practice/readable-text.ts})도 같은 범위로 먼저 막는다.
 */
public final class ActorTextCharset {
    private ActorTextCharset() {
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
