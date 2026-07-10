import json
from pathlib import Path

from acting_report.schema import ReportRecord


class FileReportStore:
    """user_id별 리포트 히스토리를 JSON 파일 하나에 저장한다.

    다음 영상 업로드 때 이전 리포트를 불러와 비교하는 용도라
    프로세스 재시작 후에도 남아야 한다 → 파일 저장.
    """

    def __init__(self, path: Path):
        self._path = Path(path)

    def _load(self) -> dict[str, list[dict]]:
        if not self._path.exists():
            return {}
        return json.loads(self._path.read_text(encoding="utf-8"))

    def _dump(self, data: dict[str, list[dict]]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def add(self, user_id: str, record: ReportRecord) -> None:
        data = self._load()
        data.setdefault(user_id, []).append(record.model_dump())
        self._dump(data)

    def list(self, user_id: str) -> list[ReportRecord]:
        data = self._load()
        return [ReportRecord.model_validate(r) for r in data.get(user_id, [])]

    def latest(self, user_id: str) -> ReportRecord | None:
        records = self.list(user_id)
        return records[-1] if records else None
