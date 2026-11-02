package com.acttub.actingapi.platform.schema;
import jakarta.persistence.Converter;
public enum ReportReason implements PgEnum {
    // 뒤의 셋은 챌린지 신고와 사유를 맞추며 V86 이 더했다(SOMA-873). 앞의 넷은 옛 게시판 앱이 보내던 값이다.
    SPAM("spam"), ABUSE("abuse"), SEXUAL("sexual"), PRIVACY("privacy"), OTHER("other"),
    COPYRIGHT("copyright"), INAPPROPRIATE("inappropriate"), DUPLICATE("duplicate");
    private final String value; ReportReason(String value){this.value=value;} public String dbValue(){return value;}
    @Converter(autoApply=false) public static class JpaConverter extends PgEnumConverter<ReportReason>{public JpaConverter(){super(ReportReason.class);}}
}
