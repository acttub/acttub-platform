package com.acttub.actingapi.platform.observability;

import java.util.regex.Pattern;

import com.acttub.actingapi.platform.security.ClientVersionFilter;
import jakarta.servlet.http.HttpServletRequest;

/**
 * 요청의 클라이언트 버전 헤더({@link ClientVersionFilter#HEADER}, 예: {@code app/1.1.2})를 요청 로그와 지표에 싣는 값으로 줄인다.
 *
 * <p><b>정해진 꼴만 그대로 둔다.</b> 헤더는 누구나 보낼 수 있으므로 받은 글자를 그대로 실으면 로그에 아무 글자나 들어간다.
 * {@code app}·{@code web} 에 숫자 마디 버전(1~3마디, 마디마다 1~4자리)이 붙은 꼴만 그대로 남기고, 그 밖은 {@value #OTHER},
 * 없거나 비었으면 {@value #NONE} 이다. 이 꼴만으로는 값 종류가 묶이지 않는다(수조 가지) — 지표의 값 종류 상한은
 * {@link HttpRequestMetrics} 가 따로 둔다. 버전 헤더는 개인을 가리키지 않는다.
 */
public final class ClientLabel {
    public static final String NONE = "none";
    public static final String OTHER = "other";

    private static final Pattern ALLOWED = Pattern.compile("(?:app|web)(?:/[0-9]{1,4}(?:\\.[0-9]{1,4}){0,2})?");

    private ClientLabel() {
    }

    public static String of(HttpServletRequest request) {
        return of(request.getHeader(ClientVersionFilter.HEADER));
    }

    static String of(String header) {
        if (header == null || header.isBlank()) return NONE;
        return ALLOWED.matcher(header).matches() ? header : OTHER;
    }
}
