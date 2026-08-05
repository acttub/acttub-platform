from typing import Protocol
from uuid import uuid4

from acting_summary.schema import ActorMaterial, ObservationPack


class SummaryStore(Protocol):
    def create_summary(
        self,
        *,
        user_id: str,
        actor: ActorMaterial,
        observation_pack: ObservationPack,
        video_filename: str | None,
        video_size_bytes: int,
        was_compressed: bool,
        model: str,
    ) -> str: ...


class InMemorySummaryStore:
    """DB-free fake used by the standalone package tests."""

    def __init__(self):
        self.records: dict[str, dict] = {}

    def create_summary(
        self,
        *,
        user_id: str,
        actor: ActorMaterial,
        observation_pack: ObservationPack,
        video_filename: str | None,
        video_size_bytes: int,
        was_compressed: bool,
        model: str,
    ) -> str:
        summary_id = str(uuid4())
        self.records[summary_id] = {
            "user_id": user_id,
            "actor": actor,
            "observation_pack": observation_pack,
            "video_filename": video_filename,
            "video_size_bytes": video_size_bytes,
            "was_compressed": was_compressed,
            "model": model,
        }
        return summary_id
