package com.acttub.actingapi.feature.support.adapter.db;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.support.app.SupportInquiryStore.Inquiry;
import com.acttub.actingapi.feature.support.schema.SupportInquiryEntity;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code support_inquiries} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface SupportInquiryJpaRepository extends Repository<SupportInquiryEntity, UUID> {

    SupportInquiryEntity save(SupportInquiryEntity inquiry);

    @Query("""
            select new com.acttub.actingapi.feature.support.app.SupportInquiryStore$Inquiry(
                i.id, i.category, i.email, i.body, i.userId, i.client, i.status, i.createdAt)
            from SupportInquiryEntity i
            where i.userId = :userId
            order by i.createdAt desc, i.id desc
            """)
    List<Inquiry> listByUser(UUID userId, Limit limit);

    @Query("""
            select new com.acttub.actingapi.feature.support.app.SupportInquiryStore$Inquiry(
                i.id, i.category, i.email, i.body, i.userId, i.client, i.status, i.createdAt)
            from SupportInquiryEntity i
            where :status is null or i.status = :status
            order by i.createdAt desc, i.id desc
            """)
    List<Inquiry> list(String status, Limit limit);

    @Query("""
            select new com.acttub.actingapi.feature.support.app.SupportInquiryStore$Inquiry(
                i.id, i.category, i.email, i.body, i.userId, i.client, i.status, i.createdAt)
            from SupportInquiryEntity i
            where i.id = :id
            """)
    Optional<Inquiry> find(UUID id);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update SupportInquiryEntity i set i.status = :status where i.id = :id")
    int updateStatus(UUID id, String status);
}
