package com.acttub.actingapi.platform.security;

import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
public class SecurityConfig {
    @Bean
    @Order(0)
    SecurityFilterChain managementSecurity(HttpSecurity http, ManagementAccessFilter management) throws Exception {
        return http.securityMatcher(management::matches)
                .csrf(c -> c.disable())
                .authorizeHttpRequests(a -> a.anyRequest().permitAll())
                .httpBasic(h -> h.disable()).formLogin(f -> f.disable())
                .addFilterBefore(management, UsernamePasswordAuthenticationFilter.class).build();
    }

    @Bean
    @Order(1)
    SecurityFilterChain apiSecurity(HttpSecurity http, AccessTokenFilter access) throws Exception {
        return http.csrf(c -> c.disable()).authorizeHttpRequests(a -> a.anyRequest().permitAll())
                .httpBasic(h -> h.disable()).formLogin(f -> f.disable())
                .addFilterBefore(access, UsernamePasswordAuthenticationFilter.class).build();
    }

    @Bean
    FilterRegistrationBean<AccessTokenFilter> accessTokenFilterRegistration(AccessTokenFilter filter) {
        FilterRegistrationBean<AccessTokenFilter> bean = new FilterRegistrationBean<>(filter);
        bean.setEnabled(false);
        return bean;
    }

    @Bean
    FilterRegistrationBean<ManagementAccessFilter> managementAccessFilterRegistration(ManagementAccessFilter filter) {
        FilterRegistrationBean<ManagementAccessFilter> bean = new FilterRegistrationBean<>(filter);
        bean.setEnabled(false);
        return bean;
    }
}
