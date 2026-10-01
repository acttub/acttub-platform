package com.acttub.actingapi.platform.security;

/**
 * 경로를 견주기 전에 끝 {@code /} 를 뗀다. 보안 판정마다 다르게 떼면 한쪽만 비껴가는 경로가 생기므로
 * 게스트 기능 판정·동의 게이트·탈퇴 계정 예외가 이 한 곳을 쓴다.
 */
final class RequestPath {

    private RequestPath() {
    }

    static String normalized(String path) {
        if (path.length() > 1 && path.endsWith("/")) {
            return path.substring(0, path.length() - 1);
        }
        return path;
    }
}
