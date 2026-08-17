package com.acttub.actingapi.admissions.app;

/**
 * admissions 가 카탈로그 원본에 요구하는 것 — 전량 한 벌.
 *
 * <p>이 도메인에는 저장소가 없다. 요강은 우리가 쓰는 데이터가 아니라 <b>바깥에서 통째로
 * 들어오는 문서</b>라, 어디서 읽어 오는지(지금은 classpath JSON)를 포트 뒤에 둔다.
 */
public interface AdmissionsCatalog {

    /**
     * 카탈로그가 실려 오는 자리. <b>이 기능을 이루는 빈 전부가 같은 조건을 져야 하므로</b>
     * 리터럴을 흩지 않는다 — 하나라도 조건이 없으면 요강 파일이 없는 기동에서 없는 빈을
     * 요구해 컨텍스트가 뜨지 못한다.
     */
    String RESOURCE = "classpath:admissions/notices.json";

    /** 카탈로그 전량. 기동 때 한 번 읽어 두므로 호출마다 자원을 건드리지 않는다. */
    Admissions.AdmissionsResponse all();
}
