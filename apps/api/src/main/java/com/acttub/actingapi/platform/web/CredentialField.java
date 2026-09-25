package com.acttub.actingapi.platform.web;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 자격 값이 실리는 요청 칸 — 제공자의 ID 토큰·authorization code, 가입 토큰, 리프레시 토큰, 이관 코드, 푸시
 * 토큰. <b>422 의 {@code input} 으로 되돌려 보내지 않는다</b> (apps/api/CONTRACT.md §6-6).
 *
 * <p>본문의 모양이 틀린 422 는 받은 값을 {@code input} 에 싣고, 빠진 칸의 {@code input} 은 본문 전체다. 그대로
 * 두면 다른 칸 하나가 빠졌을 뿐인 요청이 토큰을 응답으로 — 그리고 그 응답을 찍는 클라이언트의 로그와 오류
 * 수집으로 — 되돌린다. 이 표시가 하나라도 붙은 요청 본문은:
 *
 * <ul>
 *   <li>본문 전체를 싣는 자리에 <b>선언된 칸 가운데 자격 값이 아닌 것만</b> 싣는다. 모르는 키도 뺀다 —
 *       {@code idToken} 처럼 이름을 잘못 쓴 키에 토큰이 실려 온다.</li>
 *   <li>자격 칸 자체의 오류와 모르는 키의 오류에는 값 대신 {@link #REDACTED} 를 싣는다.</li>
 * </ul>
 *
 * 무엇이 틀렸는지는 {@code loc} 과 {@code type} 이 말한다.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.RECORD_COMPONENT)
public @interface CredentialField {

    /** 값이 있던 자리에 싣는다. 값의 길이도 모양도 알려 주지 않는다. */
    String REDACTED = "[redacted]";
}
