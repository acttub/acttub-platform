/**
 * 고객센터의 공지와 자주 묻는 질문(SOMA-834 1차).
 * 답은 이미 공개한 페이지(/pricing, /refund, /terms)와 지금 동작에 있는 것만 쓴다. 새 정책을 여기서 만들지 않는다.
 * 공지는 서버 없이 이 목록 하나로 관리한다. 새 공지는 맨 위에 넣는다.
 */
export type Notice = { date: string; title: string; body: string; href?: string };

export const NOTICES: Notice[] = [
  {
    date: "2026-10-26",
    title: "ACTTUB Pro 결제는 11월에 시작해요",
    body: "그 전에는 실제로 결제되지 않아요. 가격과 해지·환불 기준은 요금 안내에서 볼 수 있어요.",
    href: "/pricing",
  },
];

export type FaqItem = { q: string; a: string; href?: string; hrefLabel?: string };
export type FaqCategory = { id: string; title: string; items: FaqItem[] };

export const FAQ: FaqCategory[] = [
  {
    id: "account",
    title: "계정·로그인",
    items: [
      {
        q: "웹에서도 앱 계정으로 쓸 수 있나요?",
        a: "지금 웹은 로그인 없이 게스트로 써요. 웹에서 한 연습은 이관 코드로 앱 계정에 옮길 수 있어요. 앱 계정으로 웹에 로그인하는 기능은 준비하고 있어요.",
        href: "/transfer",
        hrefLabel: "앱으로 옮기기",
      },
      {
        q: "웹에서 한 연습은 어디에 남나요?",
        a: "앱으로 옮기기 전에는 그 브라우저에만 남아요. 브라우저 기록을 지우면 다시 볼 수 없으니, 계속 쓰려면 앱으로 옮겨 주세요.",
      },
      {
        q: "앱에서는 어떤 방법으로 로그인하나요?",
        a: "구글, 애플, 카카오, 네이버 간편 로그인을 써요. 안드로이드에서는 애플 로그인이 없어요.",
      },
    ],
  },
  {
    id: "billing",
    title: "결제·구독",
    items: [
      {
        q: "ACTTUB Pro는 얼마인가요?",
        a: "월 3,900원(부가세 포함)이고, 결제일부터 1개월마다 정기결제돼요. 결제는 11월에 시작해요.",
        href: "/pricing",
        hrefLabel: "요금 안내",
      },
      {
        q: "무료로 쓰다가 자동으로 유료가 되나요?",
        a: "아니요. 동의 없이 유료로 바뀌지 않아요.",
      },
    ],
  },
  {
    id: "refund",
    title: "해지·환불",
    items: [
      {
        q: "해지하면 바로 Pro를 못 쓰나요?",
        a: "자동결제만 해지하면 지금 결제한 기간이 끝날 때까지 Pro를 쓸 수 있어요.",
      },
      {
        q: "환불은 어떻게 계산하나요?",
        a: "결제 후 7일 안에 쓰지 않았으면 전액 환불해요. 썼거나 7일이 지났으면 이용한 날만큼 빼고 돌려드려요.",
        href: "/refund",
        hrefLabel: "해지·환불정책",
      },
      {
        q: "구독을 해지하면 회원 탈퇴가 되나요?",
        a: "아니요. 구독 해지와 회원 탈퇴는 따로예요. 반대로 탈퇴해도 App Store·Google Play 구독은 자동으로 해지되지 않아요.",
        href: "/account",
        hrefLabel: "계정 삭제 안내",
      },
    ],
  },
  {
    id: "usage",
    title: "코칭·리딩·챌린지 이용",
    items: [
      {
        q: "웹 게스트는 몇 번까지 분석할 수 있나요?",
        a: "게스트는 하루 3번까지 연기 영상을 분석할 수 있어요.",
        href: "/home",
        hrefLabel: "웹에서 연습하기",
      },
      {
        q: "어떤 영상을 올릴 수 있나요?",
        a: "MP4·MOV 파일로 5분 이내 영상을 올릴 수 있어요.",
      },
      {
        q: "리딩에는 어떤 대본을 넣을 수 있나요?",
        a: "TXT·DOCX·PDF·HWP 파일(50MB까지)을 넣거나 글을 붙여넣으면 화자와 대사를 나눠 드려요.",
        href: "/reading",
        hrefLabel: "리딩 시작하기",
      },
      {
        q: "챌린지는 어디서 하나요?",
        a: "챌린지 참여와 보기는 앱에서 해요.",
        href: "/app",
        hrefLabel: "앱 받기",
      },
    ],
  },
  {
    id: "error",
    title: "오류",
    items: [
      {
        q: "영상이 올라가지 않아요.",
        a: "파일 형식(MP4·MOV)과 길이(5분 이내)를 먼저 확인해 주세요. 그래도 안 되면 쓰는 기기와 브라우저를 적어 문의해 주세요.",
      },
      {
        q: "부적절한 참여작이나 댓글을 봤어요.",
        a: "앱의 신고 버튼이나 문의하기로 알려 주세요. 확인한 뒤 조치해요.",
      },
    ],
  },
];

export const INQUIRY_TYPES = ["계정·로그인", "결제·구독", "해지·환불", "기능 이용", "오류 신고", "부적절한 콘텐츠 신고", "기타"] as const;

export type InquiryType = (typeof INQUIRY_TYPES)[number];

/** 화면의 문의 유형 → 서버 category (POST /v2/support/inquiries). */
export const INQUIRY_CATEGORY: Record<InquiryType, "account" | "billing" | "refund" | "usage" | "bug" | "report" | "other"> = {
  "계정·로그인": "account",
  "결제·구독": "billing",
  "해지·환불": "refund",
  "기능 이용": "usage",
  "오류 신고": "bug",
  "부적절한 콘텐츠 신고": "report",
  기타: "other",
};

/** 서버가 받는 내용 길이(자). */
export const INQUIRY_BODY_MIN = 10;
export const INQUIRY_BODY_MAX = 3000;
