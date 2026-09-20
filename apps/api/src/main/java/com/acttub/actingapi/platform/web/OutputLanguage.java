package com.acttub.actingapi.platform.web;

import java.util.Locale;
import org.springframework.context.i18n.LocaleContextHolder;

/**
 * AI 가 어느 말로 답할지 정한다.
 *
 * <p>프롬프트 본문은 한국어 그대로 둔다. 번역하지 않고, 요청한 사람이 한국어를 쓰지 않을 때만
 * 맨 끝에 "이 말로 답하라" 한 줄을 덧붙인다. 지시하는 말과 답하는 말을 나누는 셈이다.
 *
 * <p>한국어일 때는 <b>아무것도 덧붙이지 않는다.</b> 그래서 한국어 사용자에게 나가는 프롬프트는
 * 이 변경 전과 한 글자도 다르지 않고, 프롬프트를 글자 단위로 비교하는 고정 테스트도 그대로 통과한다.
 *
 * <p>말은 요청 헤더(Accept-Language)에서 온다. 스프링이 그것을 읽어 요청 스레드에 담아 두므로
 * 따로 넘겨받을 필요가 없다. 다만 요청 스레드 밖(예약 작업 등)에서는 값이 없어 한국어로 본다 —
 * 옛 동작과 같다.
 */
public final class OutputLanguage {

    private OutputLanguage() {}

    /** 한국어 사용자에게는 빈 문자열. 그 외에는 답할 말을 지정하는 지시문. */
    public static String directive() {
        return directiveFor(current());
    }

    /** 시스템 프롬프트 끝에 답할 말 지시를 붙인다. 한국어면 받은 것을 그대로 돌려준다. */
    public static String apply(String systemPrompt) {
        String directive = directive();
        return directive.isEmpty() ? systemPrompt : systemPrompt + directive;
    }

    /**
     * 지금 요청이 쓰는 말. 알 수 없으면 한국어.
     *
     * <p>{@code LocaleContextHolder.getLocale()} 을 쓰면 안 된다 — 요청 밖에서는 그것이 서버 장비의
     * 기본 언어를 돌려주기 때문에, 장비가 영어로 잡혀 있으면 예약 작업이나 테스트에서 영어 지시가
     * 새어 나간다. 요청이 실제로 말을 실어 보냈을 때만 그 값을 쓴다.
     */
    public static Locale current() {
        var context = LocaleContextHolder.getLocaleContext();
        if (context == null) return Locale.KOREAN;
        Locale locale = context.getLocale();
        return locale == null ? Locale.KOREAN : locale;
    }

    /** 지금 요청이 한국어인가. */
    public static boolean isKorean() {
        return "ko".equals(current().getLanguage());
    }

    static String directiveFor(Locale locale) {
        if (locale == null || "ko".equals(locale.getLanguage())) return "";
        String name = languageName(locale);
        return "\n\n[Output language]\n"
                + "The instructions above are written in Korean, but the person you are talking to does not read Korean.\n"
                + "Write every word you send to them in "
                + name
                + ". This includes questions, feedback, headings, labels and any example wording.\n"
                + "Do not translate the actor's own words when you quote them — quote them exactly as they said them.\n"
                + "Keep the JSON field names exactly as specified above; only the values that the person reads change language.\n";
    }

    private static String languageName(Locale locale) {
        String name = locale.getDisplayLanguage(Locale.ENGLISH);
        return name == null || name.isBlank() ? "English" : name;
    }
}
