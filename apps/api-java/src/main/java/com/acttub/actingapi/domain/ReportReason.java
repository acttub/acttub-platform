package com.acttub.actingapi.domain;
import jakarta.persistence.Converter;
public enum ReportReason implements PgEnum {
    SPAM("spam"), ABUSE("abuse"), SEXUAL("sexual"), PRIVACY("privacy"), OTHER("other");
    private final String value; ReportReason(String value){this.value=value;} public String dbValue(){return value;}
    @Converter(autoApply=false) public static class JpaConverter extends PgEnumConverter<ReportReason>{public JpaConverter(){super(ReportReason.class);}}
}
