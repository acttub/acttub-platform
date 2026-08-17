package com.acttub.actingapi.admissions.app;

/**
 * admissions 가 카탈로그 원본에 요구하는 것 — 전량 한 벌.
 *
 * <p>이 도메인에는 저장소가 없다. 요강은 우리가 쓰는 데이터가 아니라 <b>바깥에서 통째로
 * 들어오는 문서</b>라, 어디서 읽어 오는지(지금은 classpath JSON)를 포트 뒤에 둔다.
 */
public interface AdmissionsCatalog {

    /** 카탈로그 전량. 기동 때 한 번 읽어 두므로 호출마다 자원을 건드리지 않는다. */
    Admissions.AdmissionsResponse all();
}
