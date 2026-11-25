package com.acttub.actingapi.platform.security;

/**
 * 스토어를 보고 서버가 스스로 올린 플랫폼별 최소 앱 판(SOMA-1150, {@code feature/appversion}). 빈 문자열이면 올린 것이 없다.
 * {@link ClientVersionFilter} 는 이 값과 {@code MIN_APP_VERSION_IOS}·{@code MIN_APP_VERSION_ANDROID} 중 높은 쪽으로 막는다.
 */
public interface RaisedMinimums {

    RaisedMinimums NONE = new RaisedMinimums() {
        @Override
        public String ios() {
            return "";
        }

        @Override
        public String android() {
            return "";
        }
    };

    String ios();

    String android();
}
