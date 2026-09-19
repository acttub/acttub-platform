package com.acttub.actingapi.feature.consent.domain;

/**
 * 고지 문서 — 동의를 받지 않고 <b>알리기만</b> 하는 문서. 지금은 개인정보 처리방침 하나다.
 *
 * <p>{@link ConsentDocument} 와 섞지 않는다. 동의 문서는 판마다 행이 있고 결정의 대상이며 게이트에
 * 걸린다. 고지는 그 어느 것도 아니다 — {@code consent_documents} 에 행이 없고, 결정할 수 없고,
 * 미결정으로 누구를 막지도 않는다.
 */
public record ConsentNotice(String type, String title, String body) {
}
