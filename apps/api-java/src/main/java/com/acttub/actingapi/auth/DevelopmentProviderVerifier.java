package com.acttub.actingapi.auth;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression; import org.springframework.stereotype.Component;
@Component @ConditionalOnExpression("'${DEVELOPMENT_AUTH_PROVIDER:}'.equalsIgnoreCase('true') || '${DEVELOPMENT_AUTH_PROVIDER:}' == '1'")
public class DevelopmentProviderVerifier implements ProviderVerifier {public String provider(){return "development";} public ProviderIdentity verify(String raw){String token=raw.strip();if(token.isEmpty())throw new InvalidIdentityToken("development id_token is empty");int i=token.indexOf(':');return i<0?new ProviderIdentity(token,null,false):new ProviderIdentity(token.substring(0,i),token.substring(i+1),false);}}
