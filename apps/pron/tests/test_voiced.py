"""소리 없는 앞뒤 잘라 내기(모델 없이 돈다)."""
import os
import sys

import torch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pronscore  # noqa: E402


def _tone(seconds, amp, sr=16000):
    t = torch.arange(int(seconds * sr)) / sr
    return amp * torch.sin(2 * torch.pi * 220 * t)


def _noise(seconds, amp, sr=16000):
    g = torch.Generator().manual_seed(0)
    return amp * (torch.rand(int(seconds * sr), generator=g) * 2 - 1)


def test_기다린_소리를_잘라_내고_말한_자리만_남긴다():
    wav = torch.cat([_noise(100, 0.002), _tone(3, 0.3), _noise(2, 0.002)])
    cut, offset = pronscore.voiced(wav)
    assert 3.0 <= len(cut) / 16000 <= 3.7
    assert abs(offset / 16000 - 99.7) < 0.05


def test_조용한_녹음은_그대로_둔다():
    wav = _noise(2, 0.001)
    cut, offset = pronscore.voiced(wav)
    assert len(cut) == len(wav) and offset == 0


def test_잘라도_길면_TooLong_문턱을_넘는다():
    wav = torch.cat([_tone(40, 0.3)])
    cut, _ = pronscore.voiced(wav)
    assert len(cut) / 16000 > pronscore.MAX_SECONDS
