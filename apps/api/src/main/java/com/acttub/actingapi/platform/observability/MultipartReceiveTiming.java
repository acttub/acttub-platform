package com.acttub.actingapi.platform.observability;

import java.util.Optional;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.multipart.MultipartHttpServletRequest;
import org.springframework.web.multipart.MultipartResolver;

/**
 * multipart 본문을 컨테이너가 끝까지 읽는 데 든 시간을 요청 속성에 남긴다.
 *
 * <p>Boot 가 만든 {@link MultipartResolver} 를 그대로 두고 감싸기만 한다. 기본 설정(resolve-lazily=false)에서
 * {@code DispatcherServlet} 은 핸들러를 찾기 전에 파트를 모두 읽고, 이 읽기가 소켓에서 본문을 받는 시간이다 —
 * 운영 프록시가 본문을 모아 두지 않고(proxy_request_buffering off) 흘려 보내므로 기기가 올리는 시간이 여기에 든다.
 * 헤더가 도착하기 전과 프록시 앞에서 쓴 시간은 보이지 않는다.
 */
@Configuration(proxyBeanMethods = false)
public class MultipartReceiveTiming {
    private static final String ATTRIBUTE = MultipartReceiveTiming.class.getName();

    /** {@link System#nanoTime()} 기준으로 파트 읽기를 시작하고 마친 때. */
    public record Received(long startedNanos, long finishedNanos) {
        public long nanos() {
            return finishedNanos - startedNanos;
        }
    }

    /** 이 요청의 파트를 컨테이너가 읽었을 때만 값이 있다(MockMvc 처럼 파트를 미리 채운 요청에는 없다). */
    public static Optional<Received> received(HttpServletRequest request) {
        return request.getAttribute(ATTRIBUTE) instanceof Received received ? Optional.of(received) : Optional.empty();
    }

    @Bean
    static BeanPostProcessor multipartReceiveTimer() {
        return new BeanPostProcessor() {
            @Override
            public Object postProcessAfterInitialization(Object bean, String beanName) {
                return bean instanceof MultipartResolver resolver && !(bean instanceof Timed) ? new Timed(resolver) : bean;
            }
        };
    }

    private record Timed(MultipartResolver delegate) implements MultipartResolver {
        @Override
        public boolean isMultipart(HttpServletRequest request) {
            return delegate.isMultipart(request);
        }

        @Override
        public MultipartHttpServletRequest resolveMultipart(HttpServletRequest request) throws MultipartException {
            long started = System.nanoTime();
            MultipartHttpServletRequest resolved = delegate.resolveMultipart(request);
            request.setAttribute(ATTRIBUTE, new Received(started, System.nanoTime()));
            return resolved;
        }

        @Override
        public void cleanupMultipart(MultipartHttpServletRequest request) {
            delegate.cleanupMultipart(request);
        }
    }
}
