package com.acttub.actingapi.feature.auth.app;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.acttub.actingapi.platform.security.AccessTokenVerifier;
import com.nimbusds.jwt.SignedJWT;

/**
 * Python {@code auth/jwt.py:JwtService}와 byte-level 호환되는 HS256 JWT.
 *
 * <p>토큰을 <b>발급</b>하는 것은 이 도메인의 일이라 여기 남고, 요청마다 그것을 <b>검증</b>하는
 * 배관에는 {@link AccessTokenVerifier} 로만 보인다 (ADR-017).
 */
public final class JwtService implements AccessTokenVerifier {
    public static final long ACCESS_TTL_SECONDS=30*60;
    public static final long REFRESH_TTL_SECONDS=14*24*60*60;
    private static final Set<String> REQUIRED=Set.of("iss","aud","sub","jti","token_type","iat","exp");
    private final byte[] secret; private final Clock clock; private final ObjectMapper mapper;
    public JwtService(String secret,Clock clock,ObjectMapper mapper){
        if(secret==null||secret.isEmpty()) throw new IllegalArgumentException("JWT secret must not be empty");
        this.secret=secret.getBytes(StandardCharsets.UTF_8);this.clock=clock;this.mapper=mapper;
    }
    public IssuedToken issueAccessToken(UUID userId){return issue(userId,"access",ACCESS_TTL_SECONDS,clock.instant());}
    public IssuedToken issueRefreshToken(UUID userId){return issue(userId,"refresh",REFRESH_TTL_SECONDS,clock.instant());}
    public IssuedToken issue(UUID userId,String type,long ttl,Instant now){
        Instant expires=now.plus(ttl,ChronoUnit.SECONDS);
        Map<String,Object> header=new java.util.LinkedHashMap<>();header.put("alg","HS256");header.put("typ","JWT");
        Map<String,Object> payload=new java.util.LinkedHashMap<>();payload.put("iss","acting-api");payload.put("aud","acting-app");payload.put("sub",userId.toString());payload.put("jti",UUID.randomUUID().toString());payload.put("token_type",type);payload.put("iat",now.getEpochSecond());payload.put("exp",expires.getEpochSecond());
        try{
            String h=b64(mapper.writeValueAsBytes(header)),p=b64(mapper.writeValueAsBytes(payload));String input=h+"."+p;
            return new IssuedToken(input+"."+b64(hmac(input.getBytes(StandardCharsets.US_ASCII))),expires);
        }catch(Exception e){throw new IllegalStateException("failed to issue JWT",e);}
    }
    public TokenClaims decodeAccessToken(String token){return decode(token,"access",clock.instant());}
    /** 배관이 보는 얼굴. 어긋난 토큰을 예외 대신 {@code null} 로 알린다 — 이유는 포트 쪽에 적었다. */
    @Override public UUID verifyAccessToken(String token){try{return decodeAccessToken(token).userId();}catch(TokenValidationException e){return null;}}
    public TokenClaims decodeRefreshToken(String token){return decode(token,"refresh",clock.instant());}
    public TokenClaims decode(String token,String expectedType,Instant now){
        try{
            String[] parts=token.split("\\.",-1);if(parts.length!=3)throw invalid("invalid token structure");
            byte[] actual=Base64.getUrlDecoder().decode(pad(parts[2]));byte[] expected=hmac((parts[0]+"."+parts[1]).getBytes(StandardCharsets.US_ASCII));
            if(!MessageDigest.isEqual(actual,expected))throw invalid("invalid token signature");
            SignedJWT parsed=SignedJWT.parse(token);
            if(!parsed.getHeader().toJSONObject().equals(Map.of("alg","HS256","typ","JWT")))throw invalid("unsupported token header");
            Map<String,Object> claims=mapper.readValue(Base64.getUrlDecoder().decode(pad(parts[1])),new TypeReference<>(){});
            if(!claims.keySet().containsAll(REQUIRED))throw invalid("missing token claims");
            if(!"acting-api".equals(claims.get("iss"))||!"acting-app".equals(claims.get("aud")))throw invalid("invalid token issuer or audience");
            if(!expectedType.equals(claims.get("token_type")))throw invalid("wrong token type");
            if(!(claims.get("iat") instanceof Integer||claims.get("iat") instanceof Long)||!(claims.get("exp") instanceof Integer||claims.get("exp") instanceof Long))throw invalid("invalid token timestamps");
            long iat=((Number)claims.get("iat")).longValue(),exp=((Number)claims.get("exp")).longValue(),checked=now.getEpochSecond();
            if(iat>checked||exp<=checked)throw invalid("token is expired or not yet valid");
            return new TokenClaims(UUID.fromString((String)claims.get("sub")),UUID.fromString((String)claims.get("jti")),Instant.ofEpochSecond(exp));
        }catch(TokenValidationException e){throw e;}catch(Exception e){throw invalid("invalid token");}
    }
    public static String hashToken(String token){
        try{return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));}catch(Exception e){throw new IllegalStateException(e);}
    }
    private byte[] hmac(byte[] input)throws Exception{Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(secret,"HmacSHA256"));return mac.doFinal(input);}
    private static String b64(byte[] value){return Base64.getUrlEncoder().withoutPadding().encodeToString(value);} private static String pad(String s){return s+"=".repeat((4-s.length()%4)%4);}
    private static TokenValidationException invalid(String message){return new TokenValidationException(message);}
    public record IssuedToken(String value,Instant expiresAt){} public record TokenClaims(UUID userId,UUID tokenId,Instant expiresAt){}
    public static class TokenValidationException extends RuntimeException{public TokenValidationException(String message){super(message);}}
}
