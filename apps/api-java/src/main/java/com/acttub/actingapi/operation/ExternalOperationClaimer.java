package com.acttub.actingapi.operation;
import java.time.*; import java.util.*; import org.springframework.jdbc.core.JdbcTemplate; import org.springframework.stereotype.Repository;
/** 원본의 blocking + 재평가 시맨틱을 보존한다. 의도적으로 SKIP LOCKED가 없다. */
@Repository public class ExternalOperationClaimer {private final JdbcTemplate jdbc;public ExternalOperationClaimer(JdbcTemplate jdbc){this.jdbc=jdbc;}public UUID claimNext(String kind,UUID leaseToken,Duration duration,Instant now){List<UUID> ids=jdbc.query("""
UPDATE external_operations SET status='running'::operation_status_t,attempt_count=attempt_count+1,lease_token=?,lease_expires_at=?,error_code=NULL,response_payload=NULL,updated_at=?
WHERE id=(SELECT id FROM external_operations WHERE kind=?::operation_kind_t AND attempt_count<3 AND ((status='pending'::operation_status_t AND lease_token IS NULL) OR (status='running'::operation_status_t AND lease_expires_at<?)) ORDER BY created_at,id LIMIT 1)
AND kind=?::operation_kind_t AND attempt_count<3 AND ((status='pending'::operation_status_t AND lease_token IS NULL) OR (status='running'::operation_status_t AND lease_expires_at<?)) RETURNING id
""",(rs,n)->rs.getObject(1,UUID.class),leaseToken,now.plus(duration).atOffset(ZoneOffset.UTC),now.atOffset(ZoneOffset.UTC),kind,now.atOffset(ZoneOffset.UTC),kind,now.atOffset(ZoneOffset.UTC));return ids.isEmpty()?null:ids.getFirst();}}
