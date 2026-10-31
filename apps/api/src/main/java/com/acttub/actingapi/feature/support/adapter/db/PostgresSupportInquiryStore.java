package com.acttub.actingapi.feature.support.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.support.app.SupportInquiryStore;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 문의의 Postgres 구현 — {@code support_inquiries} (V63). */
@Repository
class PostgresSupportInquiryStore implements SupportInquiryStore {

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresSupportInquiryStore(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public void insert(NewInquiry inquiry, Instant now) {
        transaction.executeWithoutResult(tx -> entityManager.createNativeQuery("""
                INSERT INTO support_inquiries(id,category,email,body,user_id,client,status,created_at)
                VALUES (:id,:category,:email,:body,CAST(:userId AS uuid),CAST(:client AS text),'open',:now)
                """)
                .setParameter("id", inquiry.id())
                .setParameter("category", inquiry.category())
                .setParameter("email", inquiry.email())
                .setParameter("body", inquiry.body())
                .setParameter("userId", inquiry.userId())
                .setParameter("client", inquiry.client())
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .executeUpdate());
    }

    @Override
    public List<Inquiry> listByUser(UUID userId, int limit) {
        return NativeTuples.list(entityManager.createNativeQuery("""
                SELECT id,category,email,body,user_id,client,status,created_at
                FROM support_inquiries
                WHERE user_id=:userId
                ORDER BY created_at DESC,id DESC
                LIMIT :limit
                """, Tuple.class)
                .setParameter("userId", userId)
                .setParameter("limit", limit)).stream().map(PostgresSupportInquiryStore::map).toList();
    }

    private static Inquiry map(Tuple row) {
        return new Inquiry(
                row.get("id", UUID.class),
                row.get("category", String.class),
                row.get("email", String.class),
                row.get("body", String.class),
                row.get("user_id", UUID.class),
                row.get("client", String.class),
                row.get("status", String.class),
                row.get("created_at", Instant.class));
    }

    @Override
    public List<Inquiry> list(String status, int limit) {
        return NativeTuples.list(entityManager.createNativeQuery("""
                SELECT id,category,email,body,user_id,client,status,created_at
                FROM support_inquiries
                WHERE CAST(:status AS text) IS NULL OR status=CAST(:status AS text)
                ORDER BY created_at DESC,id DESC
                LIMIT :limit
                """, Tuple.class)
                .setParameter("status", status)
                .setParameter("limit", limit)).stream()
                .map(row -> new Inquiry(
                        row.get("id", UUID.class),
                        row.get("category", String.class),
                        row.get("email", String.class),
                        row.get("body", String.class),
                        row.get("user_id", UUID.class),
                        row.get("client", String.class),
                        row.get("status", String.class),
                        row.get("created_at", Instant.class)))
                .toList();
    }
}
