import re

FORBIDDEN_WORDS = [
    "점수",
    "등급",
    "진정성",
    "몰입도",
    "감정 전달력",
    "연기력",
    "합격",
    "불합격",
    "좋다",
    "좋아",
    "좋은",
    "좋았",
    "나쁘다",
    "나빠",
    "나쁜",
    "나쁘",
    "나빴",
    # 1층 분석 노출 어휘 — 발화는 연기 현장 언어로만 한다
    "피치",
    "데시벨",
    "헤르츠",
    "구간",
    "Hz",
    "dB",
    "severity",
]

# 00:45, 0:45-0:55 같은 타임스탬프 표기 — 시간은 focus_timestamp로만 전달한다
_TIMESTAMP = re.compile(r"\d{1,2}:\d{2}")


def has_forbidden(text: str) -> bool:
    if _TIMESTAMP.search(text):
        return True
    return any(word in text for word in FORBIDDEN_WORDS)
