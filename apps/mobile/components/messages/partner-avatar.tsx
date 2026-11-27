import { Image } from 'expo-image';

import { DefaultAvatar } from '@/components/ui/default-avatar';
import { radius } from '@/constants/tokens';

/** 1:1 메시지 상대 사진(SOMA-1039). 없으면 기본 얼굴 — 게시판과 같은 씨앗(작성자 id)이라 같은 사람은 같은 색이다. */
export function PartnerAvatar({ uri, seed, size }: { uri: string | null; seed: string; size: number }) {
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: radius.full }} contentFit="cover" />;
  return <DefaultAvatar size={size} radius={size / 2} seed={seed} />;
}
