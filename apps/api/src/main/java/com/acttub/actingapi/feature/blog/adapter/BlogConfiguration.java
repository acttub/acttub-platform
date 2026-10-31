package com.acttub.actingapi.feature.blog.adapter;

import java.time.Clock;

import com.acttub.actingapi.feature.blog.app.BlogImages;
import com.acttub.actingapi.feature.blog.app.BlogRepository;
import com.acttub.actingapi.feature.blog.app.BlogService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 블로그 서비스의 조립. 운영 경로가 꺼진 기동에서도 공개 읽기가 쓰므로 조건 없이 선다. */
@Configuration
class BlogConfiguration {

    @Bean
    BlogService blogService(BlogRepository posts, BlogImages images, Clock clock) {
        return new BlogService(posts, images, clock);
    }
}
