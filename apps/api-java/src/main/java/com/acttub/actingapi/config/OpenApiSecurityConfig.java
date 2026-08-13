package com.acttub.actingapi.config;
import io.swagger.v3.oas.annotations.enums.SecuritySchemeType; import io.swagger.v3.oas.annotations.security.SecurityScheme; import org.springframework.context.annotation.Configuration;
@Configuration @SecurityScheme(name="HTTPBearer",type=SecuritySchemeType.HTTP,scheme="bearer") public class OpenApiSecurityConfig {}
