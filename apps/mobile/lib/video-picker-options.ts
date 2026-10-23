import type * as ImagePicker from 'expo-image-picker';

/**
 * 연기 영상을 갤러리에서 고를 때 쓰는 공통 옵션.
 *
 * - allowsEditing을 켜면 iOS가 새 사진 선택기(PHPicker) 대신 옛 UIImagePickerController를 띄워
 *   갤러리 전체를 읽느라 열리는 데 오래 걸리고, 고른 뒤에도 자르기 화면과 다시 내보내기가 붙는다.
 * - iOS 기본(automatic)은 HEVC 영상을 호환 형식으로 다시 인코딩하느라 고른 뒤 한참 멈춘다.
 *   크기는 앱이 올리기 전에 따로 줄이므로(lib/compress) 원본을 그대로 받는다.
 */
export const VIDEO_PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['videos'],
  allowsEditing: false,
  // UIImagePickerPreferredAssetRepresentationMode.Current — 값으로 적어 picker 모듈을 불러오지 않는다(시험의 모듈 대역과 무관하게).
  preferredAssetRepresentationMode: 'current' as ImagePicker.UIImagePickerPreferredAssetRepresentationMode,
};
