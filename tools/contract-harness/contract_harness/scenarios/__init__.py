"""시나리오 레지스트리."""

from __future__ import annotations

from contract_harness.framework import Scenario
from contract_harness.scenarios import (
    community,
    core,
    edges,
    errors,
    inflight,
    worker,
)

SCENARIOS: tuple[Scenario, ...] = (
    Scenario("health", core.health, description="/health 형상"),
    Scenario("main-flow", core.main_flow, description="로그인→업로드→분석→코치→리포트"),
    Scenario("coach-resume", core.coach_resume_restart, description="resume·restart"),
    Scenario("community", community.community, description="커뮤니티 16개 경로"),
    Scenario("community-traversal", community.cursor_traversal, description="커서 순회"),
    Scenario("profile", community.profile, description="/v2/me"),
    Scenario("admissions", community.admissions, description="입시 공개 조회"),
    Scenario(
        "admin",
        community.admin,
        profile="admin",
        description="admin 프로파일 (ADMIN_OPS_TOKEN)",
    ),
    Scenario(
        "no-background-worker",
        worker.no_background_worker,
        description="contract 프로파일에서 자동 워커가 뜨지 않는다",
    ),
    Scenario("worker-failure", worker.worker_failure, description="워커 실패 경로"),
    Scenario(
        "inflight-replay",
        inflight.in_flight_replay,
        description="running 중 replay → 409 request is still processing",
    ),
    Scenario(
        "lease-stolen",
        inflight.lease_stolen,
        description="처리 중 lease 탈취 → 409 (라우트 4곳)",
    ),
    Scenario(
        "expired-intent",
        inflight.expired_upload_intent,
        description="만료된 upload intent → 409",
    ),
    Scenario("reanalyze", worker.reanalyze, description="재분석 멱등 전이"),
    Scenario("concurrency", worker.concurrency, description="동시성"),
    Scenario("consent-gate", edges.consent_gate_matrix, description="동의 전 matrix"),
    Scenario("token-corpus", edges.token_corpus, description="JWT 거부 corpus"),
    Scenario("refresh-rotation", edges.refresh_rotation, description="refresh 회전"),
    Scenario("rate-limiter", edges.rate_limiter, description="레이트리밋 경계"),
    Scenario("request-validation", edges.request_validation, description="요청 validation 경계"),
    Scenario("unknown-keys", edges.unknown_keys, description="요청 바디 unknown key 정책"),
    Scenario("status-codes", errors.status_codes, description="상태코드 모음"),
    Scenario(
        "no-storage",
        errors.no_storage,
        profile="nostorage",
        description="s3_storage 미주입 프로파일",
    ),
    Scenario("error-manifest", errors.error_manifest, description="오류 계약 실행 manifest"),
)

BY_NAME = {scenario.name: scenario for scenario in SCENARIOS}
