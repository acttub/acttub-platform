// "질문 받기"를 누른 순간 벌어지는 일. 순서가 뜻을 가지므로 자리를 하나로 모은다 —
// 압축·업로드를 먼저 띄워야 배우가 막힘을 고르는 동안 그것이 뒤에서 돈다.
//
// 화면이 무엇으로 바뀌는지도, 무엇을 세는지도 여기서 정하지 않는다(부르는 쪽이
// 콜백으로 준다). 이 모듈이 정하는 것은 무엇을 어떤 순서로 부르는가와, 영상이
// 없을 때 아무것도 하지 않는다는 것 둘이다.

export type BlockageEntryDeps = {
  /** 배우가 고른 영상. 없으면 아무것도 하지 않는다 — 막힘 화면은 영상 없이 설 수 없다. */
  video: { file: File } | null;
  startUpload: (file: File) => void;
  goToBlockage: () => void;
  /** 이 진입을 계측한다. 무엇을 세는지는 어느 버튼이 불렀는지에 따라 갈린다. */
  track: () => void;
};

export function enterBlockageSelection({
  video,
  startUpload,
  goToBlockage,
  track,
}: BlockageEntryDeps): void {
  if (!video) return;
  startUpload(video.file);
  goToBlockage();
  track();
}
