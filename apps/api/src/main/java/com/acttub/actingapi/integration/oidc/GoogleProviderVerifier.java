package com.acttub.actingapi.integration.oidc;
import java.util.Set; import org.springframework.beans.factory.annotation.*; import org.springframework.security.oauth2.core.*; import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm; import org.springframework.security.oauth2.jwt.*; import org.springframework.stereotype.Component;
@Component public class GoogleProviderVerifier implements ProviderVerifier {
    public static final String DEFAULT_CLIENT_ID="462651930952-625pcnhrjib79r7990fqsdqhsterdij2.apps.googleusercontent.com";
    private final String audience; private final JwtDecoder decoder;
    @Autowired public GoogleProviderVerifier(@Value("${GOOGLE_OAUTH_CLIENT_ID:"+DEFAULT_CLIENT_ID+"}")String audience){this(audience,decoder(audience));}
    public GoogleProviderVerifier(String audience,JwtDecoder decoder){this.audience=audience;this.decoder=decoder;}
    public String provider(){return "google";} public ProviderIdentity verify(String token){if(audience==null||audience.isBlank())throw new ProviderConfigurationError("GOOGLE_OAUTH_CLIENT_ID not configured");try{return OidcClaims.identity(decoder.decode(token),"google");}catch(JwtException e){throw new InvalidIdentityToken("invalid google id_token",e);}}
    static JwtDecoder decoder(String audience){NimbusJwtDecoder value=NimbusJwtDecoder.withJwkSetUri("https://www.googleapis.com/oauth2/v3/certs").jwsAlgorithm(SignatureAlgorithm.RS256).build();value.setJwtValidator(validator(audience));return value;}
    static OAuth2TokenValidator<Jwt> validator(String audience){return new DelegatingOAuth2TokenValidator<>(JwtValidators.createDefault(),jwt->Set.of("accounts.google.com","https://accounts.google.com").contains(jwt.getClaims().get("iss"))?OAuth2TokenValidatorResult.success():OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token","invalid issuer",null)),jwt->jwt.getAudience().contains(audience)?OAuth2TokenValidatorResult.success():OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token","invalid audience",null)));}
}
