package com.acttub.actingapi.domain;
import jakarta.persistence.Converter;
public enum UploadStatus implements PgEnum {
    PENDING("pending"), FINALIZED("finalized"), EXPIRED("expired");
    private final String value; UploadStatus(String value){this.value=value;} public String dbValue(){return value;}
    @Converter(autoApply=false) public static class JpaConverter extends PgEnumConverter<UploadStatus>{public JpaConverter(){super(UploadStatus.class);}}
}
