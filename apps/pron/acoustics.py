"""리딩 녹음 코치(SOMA-791)가 말할 소리를 서버가 먼저 잰다. 모델 없이 파형만 본다.

코치 모델이 녹음을 듣고 "작아져요", "커져요"를 스스로 판단하면 실제 음량과 반대로 말한 일이 있었다(dev 10/21).
그래서 줄마다 크기·빠르기·쉼·끝 높이를 재고, api 가 다른 줄과 확실히 다른 것만 관찰 후보로 고른다.
"""
import re

import torch

import pronscore

SR = 16000
HOP = 320  # 20ms
PAUSE_MIN_MS = 300


def _frames(wav):
    n = len(wav) // HOP
    return wav[: n * HOP].reshape(n, HOP) if n else wav.reshape(0, HOP)


def _db(x):
    return 20 * torch.log10(torch.clamp(x, min=1e-6))


def _pitch(frame):
    """20ms 두 개를 이은 40ms 창의 자기상관 기본 주파수(70~400Hz). 주기성이 약하면 None."""
    x = frame - frame.mean()
    if x.abs().max() < 1e-4:
        return None
    ac = torch.nn.functional.conv1d(x.view(1, 1, -1), x.view(1, 1, -1), padding=len(x) - 1).view(-1)[len(x) - 1:]
    lo, hi = SR // 400, SR // 70
    if hi >= len(ac):
        return None
    lag = int(torch.argmax(ac[lo:hi])) + lo
    if ac[lag] < 0.3 * ac[0]:
        return None
    return SR / lag


def measure(path, text):
    """한 줄 녹음의 소리 값. 말소리를 못 찾으면 None.

    loud_db: 말소리 구간 중 큰 쪽 30% 의 평균 크기(dBFS). rate: 1초에 읽은 글자(대본 한글 글자 / 말소리로 잡힌 시간).
    max_pause_ms: 말 사이 가장 긴 쉼(300ms 이상만). end_semitones: 마지막 25% 의 높이 - 앞 75% 의 높이(반음).
    end_loud_db: 마지막 25% 의 크기 - 앞 75% 의 크기."""
    wav, _ = pronscore.voiced(pronscore.load(path))
    frames = _frames(wav)
    if len(frames) < 10:
        return None
    energy = frames.pow(2).mean(1).sqrt()
    threshold = max(torch.quantile(energy, 0.1).item() * 3.0, 0.005)
    speech = energy > threshold
    if int(speech.sum()) < 5:
        return None
    voiced_db = _db(energy[speech])
    top = torch.sort(voiced_db).values[-max(1, int(len(voiced_db) * 0.3)):]
    pauses, run = [], 0
    for s in speech.tolist():
        if s:
            if run * 20 >= PAUSE_MIN_MS:
                pauses.append(run * 20)
            run = 0
        else:
            run += 1
    syllables = len(re.findall(r"[가-힣]", pronscore.normalize(text)))
    speaking_s = int(speech.sum()) * 20 / 1000
    idx = speech.nonzero().flatten().tolist()
    cut = idx[int(len(idx) * 0.75)] if len(idx) >= 8 else None
    pitches = []
    for i in idx:
        if i + 1 < len(frames):
            f = _pitch(torch.cat([frames[i], frames[i + 1]]))
            if f:
                pitches.append((i, f))
    end_st = None
    if cut is not None:
        head = [f for i, f in pitches if i < cut]
        tail = [f for i, f in pitches if i >= cut]
        if len(head) >= 5 and len(tail) >= 3:
            end_st = round(12 * torch.log2(torch.tensor(sorted(tail)[len(tail) // 2] / sorted(head)[len(head) // 2])).item(), 1)
    end_loud = None
    if cut is not None:
        head_e = [e for i, e in zip(idx, _db(energy[speech]).tolist()) if i < cut]
        tail_e = [e for i, e in zip(idx, _db(energy[speech]).tolist()) if i >= cut]
        if head_e and tail_e:
            end_loud = round(sum(tail_e) / len(tail_e) - sum(head_e) / len(head_e), 1)
    return {
        "loud_db": round(top.mean().item(), 1),
        "rate": round(syllables / speaking_s, 2) if syllables and speaking_s > 0.3 else None,
        "max_pause_ms": max(pauses) if pauses else 0,
        "end_semitones": end_st,
        "end_loud_db": end_loud,
        "speech_ms": int(speech.sum()) * 20,
    }
