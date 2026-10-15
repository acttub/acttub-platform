package com.acttub.actingapi.integration.llm;

/**
 * 기능별 외부 API 키 선택. 앞에서부터 처음으로 비어 있지 않은 값을 쓴다 — 기능 전용 키가 있으면 그것이,
 * 없거나 공백이면 옛 공용 키(GEMINI_API_KEY·OPENAI_API_KEY)가 마이그레이션용으로 받친다.
 * 환경(dev·prod)은 같은 변수 이름에 각 서버 .env 가 다른 값을 넣어 가른다. URL 로 가르지 않는다.
 */
public final class ApiKeys {
    private ApiKeys() {
    }

    public static String firstNonBlank(String... candidates) {
        for (String candidate : candidates) {
            if (candidate != null && !candidate.isBlank()) {
                return candidate.strip();
            }
        }
        return "";
    }
}
