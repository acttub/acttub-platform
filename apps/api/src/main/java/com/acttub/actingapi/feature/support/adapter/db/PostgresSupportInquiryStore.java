package com.acttub.actingapi.feature.support.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.support.app.SupportInquiryStore;
import com.acttub.actingapi.feature.support.schema.SupportInquiryEntity;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 문의의 Postgres 구현 — {@code support_inquiries} (V63). */
@Repository
class PostgresSupportInquiryStore implements SupportInquiryStore {

    private final SupportInquiryJpaRepository inquiries;
    private final TransactionTemplate transaction;

    PostgresSupportInquiryStore(SupportInquiryJpaRepository inquiries, PlatformTransactionManager transactionManager) {
        this.inquiries = inquiries;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public void insert(NewInquiry inquiry, Instant now) {
        inquiries.save(new SupportInquiryEntity(inquiry.id(), inquiry.category(), inquiry.email(), inquiry.body(),
                inquiry.userId(), inquiry.client(), "open", now));
    }

    @Override
    public List<Inquiry> listByUser(UUID userId, int limit) {
        return inquiries.listByUser(userId, Limit.of(limit));
    }

    /**
     * UPDATE 가 행을 잡은 채 같은 트랜잭션에서 다시 읽는다 — 커밋까지 다른 운영자의 UPDATE 는 기다리므로 읽은 값은 방금 쓴
     * 값이다. HQL 에 {@code RETURNING} 이 없어 문장이 하나 는다(apps/api/CONTRACT.md §5-9).
     */
    @Override
    public Optional<Inquiry> setStatus(UUID id, String status) {
        return transaction.execute(tx -> inquiries.updateStatus(id, status) == 0
                ? Optional.<Inquiry>empty()
                : inquiries.find(id));
    }

    @Override
    public List<Inquiry> list(String status, int limit) {
        return inquiries.list(status, Limit.of(limit));
    }
}
