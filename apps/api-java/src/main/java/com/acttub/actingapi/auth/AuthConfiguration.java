package com.acttub.actingapi.auth;
import java.time.Clock; import com.fasterxml.jackson.databind.ObjectMapper; import org.springframework.beans.factory.annotation.Value; import org.springframework.context.annotation.*;
@Configuration
public class AuthConfiguration {
    @Bean @Profile("!contract") Clock applicationClock(){return Clock.systemUTC();}
    @Bean JwtService jwtService(@Value("${JWT_SECRET:}")String secret,Clock clock,ObjectMapper mapper){return new JwtService(secret,clock,mapper);}
}
