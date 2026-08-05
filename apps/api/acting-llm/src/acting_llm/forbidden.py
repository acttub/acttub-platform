import re
import unicodedata

LITERAL_FORBIDDEN = [
    "점수",
    "등급",
    "랭킹",
    "점 만점",
    "합격",
    "캐스팅 적합",
    "강점",
    "약점",
    "개선점",
    "몰입이 부족",
    "집중력이 부족",
    "감정이 부족",
    "표현력이 부족",
    "실력이 부족",
    "연기가 부족",
    "잘함",
    "못함",
    "진정성",
    "감정 전달력",
    "몰입도",
    "자연스러움",
    "감정이 얕",
    "더 깊게 느껴",
    "더 자연스럽게",
    "진심으로",
    "감정을 담아",
    "믿고 한 번 더",
    "집중력이 부족",
    "blockage_type",
    "exercise_code",
    "instruction_level",
    "ANALYSIS",
    "EXPRESSION",
    "PROBE",
    "리포트",
    "4축",
    "이해했어요?",
]

REGEX_FORBIDDEN = [
    ("배우 책임 전가", re.compile(r"배우님이[^.!?\n]{0,40}해서\s*그래요", re.IGNORECASE)),
    (
        "개인 상처 소환",
        re.compile(
            r"(실제|본인|개인적인?)\s*(어머니|아버지|가족|상처|트라우마).{0,18}(떠올|생각해)",
            re.IGNORECASE,
        ),
    ),
    (
        "정신상태 단정",
        re.compile(r"(정신상태|성격|트라우마).{0,12}(입니다|이에요|예요|때문)", re.IGNORECASE),
    ),
]

SAFE_RUNTIME_REPLACEMENT = (
    "이 문장은 지금 보여드리지 않고, 더 안전한 방식으로 다시 바꿔볼게요."
)


def scan_forbidden(text: str) -> list[str]:
    normalized = unicodedata.normalize("NFKC", text)
    lowered = normalized.lower()
    hits = [term for term in LITERAL_FORBIDDEN if term.lower() in lowered]
    for label, pattern in REGEX_FORBIDDEN:
        if pattern.search(normalized):
            hits.append(label)
    return list(dict.fromkeys(hits))


def scan_generated_strings(strings: list[str]) -> list[str]:
    return list(
        dict.fromkeys(hit for string in strings for hit in scan_forbidden(string))
    )
