from acting_agent.summary_schema import ActorMaterial, ObservationPack

PRACTICE_SESSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
SUMMARY_ID = "12345678-1234-4234-9234-123456789abc"
SESSION_ID = "87654321-4321-4321-8321-cba987654321"
ACTOR = ActorMaterial(
    situation="상황",
    character="인물",
    goal="상대가 멈추게 한다",
    blockage_kind="분석",
    blockage_detail="왜 지금 말하는지 모르겠다",
    duration_ms=1000,
)
SUMMARY = ObservationPack(
    observations=[
        {
            "start_ms": 120,
            "end_ms": 130,
            "label": "대사 직전에 숨을 들이쉰다",
            "confidence": 0.9,
        }
    ],
    uncertainties=["얼굴은 확인되지 않음"],
)
