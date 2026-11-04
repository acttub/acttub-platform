package com.acttub.actingapi.integration.observation;

/**
 * 받아쓰기 모델이 응답은 했지만 받아쓴 말이 하나도 없다(후보·받아쓰기 칸이 없거나 글만 왔다). 코칭은 지금처럼 바깥 실패로
 * 다루고, 리딩 다시 받아쓰기는 이것을 "말 없음"으로 보고 같은 녹음을 다시 보내지 않는다.
 */
public final class NoSpeechInResponse extends IllegalArgumentException {
    public NoSpeechInResponse(String message) {
        super(message);
    }

    /** 감싼 예외 안쪽까지 보고 이 실패가 들어 있으면 {@code true}. */
    public static boolean within(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof NoSpeechInResponse) {
                return true;
            }
            if (cause.getCause() == cause) {
                return false;
            }
        }
        return false;
    }
}
