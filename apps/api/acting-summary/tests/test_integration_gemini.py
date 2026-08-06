import os

import pytest

from acting_summary.config import load_settings
from acting_summary.schema import ActorMaterial, ObservationPack
from acting_summary.summarizer import summarize

pytestmark = pytest.mark.gemini


def test_real_gemini_summarize():
    sample = os.environ.get("SAMPLE_VIDEO")
    if not sample or not os.path.exists(sample):
        pytest.skip("SAMPLE_VIDEO env(영상 경로) 미설정")
    settings = load_settings()
    from google import genai

    client = genai.Client(api_key=settings.api_key)
    out = summarize(
        sample,
        ActorMaterial(
            situation="테스트 상황",
            character="테스트 인물",
            goal="상대가 멈추게 한다",
            blockage_kind="분석",
            blockage_detail="왜 지금 말하는지 모르겠다",
            duration_ms=1000,
        ),
        client=client,
        model=settings.model,
    )
    assert isinstance(out, ObservationPack)
    assert len(out.observations) <= 3
