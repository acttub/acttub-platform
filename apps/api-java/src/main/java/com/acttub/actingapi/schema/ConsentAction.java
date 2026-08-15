package com.acttub.actingapi.schema;
import jakarta.persistence.Converter;
public enum ConsentAction implements PgEnum {
    GRANTED("granted"), DECLINED("declined"), REVOKED("revoked");
    private final String value; ConsentAction(String value){this.value=value;} public String dbValue(){return value;}
    @Converter(autoApply=false) public static class JpaConverter extends PgEnumConverter<ConsentAction>{public JpaConverter(){super(ConsentAction.class);}}
}
