package com.acttub.actingapi.feature.portfolio.adapter;

import java.time.Clock;

import com.acttub.actingapi.feature.portfolio.app.PortfolioOwners;
import com.acttub.actingapi.feature.portfolio.app.PortfolioPhotoStorage;
import com.acttub.actingapi.feature.portfolio.app.PortfolioRepository;
import com.acttub.actingapi.feature.portfolio.app.PortfolioService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 공유 링크의 주소는 웹의 공개 주소에서 나온다. 웹이 {@code NEXT_PUBLIC_SITE_URL} 로 받는 그 값을 서버는
 * {@code SITE_URL} 로 받는다 — 코드에 박아 두지 않는다. 비어 있으면 응답의 {@code url} 이 {@code null} 이다.
 */
@Configuration
class PortfolioConfiguration {

    @Bean
    PortfolioService portfolioService(
            PortfolioRepository portfolios,
            PortfolioPhotoStorage photos,
            PortfolioOwners owners,
            Clock clock,
            @Value("${SITE_URL:}") String siteUrl) {
        return new PortfolioService(portfolios, photos, owners, clock, siteUrl);
    }
}
