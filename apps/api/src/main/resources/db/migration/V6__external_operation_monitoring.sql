ALTER TABLE external_operations
    ADD COLUMN last_failure_classification text,
    ADD COLUMN waiting_since timestamptz,
    ADD COLUMN execution_started_at timestamptz,
    ADD COLUMN monitoring_updated_at timestamptz,
    ADD COLUMN monitoring_lease_token uuid,
    ADD CONSTRAINT ck_external_operations_last_failure_classification
        CHECK (last_failure_classification IN ('expected', 'external', 'unexpected'));
