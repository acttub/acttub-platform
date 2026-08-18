package com.acttub.actingapi.integration.oidc;
import java.util.*; import org.springframework.beans.factory.annotation.*; import org.springframework.security.oauth2.core.*; import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm; import org.springframework.security.oauth2.jwt.*; import org.springframework.stereotype.Component;
@Component public class AppleProviderVerifier implements ProviderVerifier {
    public static final String DEFAULT_CLIENT_ID="com.acttub.app",ISSUER="https://appleid.apple.com",JWKS="https://appleid.apple.com/auth/keys";
    private final List<String> audiences; private final JwtDecoder decoder;
    @Autowired public AppleProviderVerifier(@Value("${APPLE_OAUTH_CLIENT_ID:"+DEFAULT_CLIENT_ID+"}")String ids){this(ids,ids==null||ids.isBlank()?null:decoder(ids));}
    public AppleProviderVerifier(String ids,JwtDecoder decoder){this.audiences=ids==null?List.of():Arrays.stream(ids.split(",")).map(String::strip).filter(s->!s.isEmpty()).toList();this.decoder=decoder;}
    public String provider(){return "apple";} public ProviderIdentity verify(String token){if(audiences.isEmpty()||decoder==null)throw new ProviderConfigurationError("APPLE_OAUTH_CLIENT_ID not configured");try{return OidcClaims.identity(decoder.decode(token),"apple");}catch(JwtException e){throw new InvalidIdentityToken("invalid apple id_token",e);}}
    static JwtDecoder decoder(String ids){NimbusJwtDecoder value=NimbusJwtDecoder.withJwkSetUri(JWKS).jwsAlgorithm(SignatureAlgorithm.RS256).build();value.setJwtValidator(validator(ids));return value;}
    static OAuth2TokenValidator<Jwt> validator(String ids){List<String> audiences=Arrays.stream(ids.split(",")).map(String::strip).filter(s->!s.isEmpty()).toList();return new DelegatingOAuth2TokenValidator<>(JwtValidators.createDefaultWithIssuer(ISSUER),jwt->jwt.getAudience().stream().anyMatch(audiences::contains)?OAuth2TokenValidatorResult.success():OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token","invalid audience",null)));}
}
