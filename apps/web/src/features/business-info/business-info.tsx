/** 하단 사업자 정보. 통신판매업 신고번호가 나오면 MAIL_ORDER_REPORT_NO 한 곳만 바꾼다. */
export const MAIL_ORDER_REPORT_NO = "신고 처리 중";

export const BUSINESS_INFO = {
  name: "액터브(ACTTUB)",
  representative: "최우영",
  registrationNo: "796-11-03104",
  registrationCheckUrl: "https://www.ftc.go.kr/bizCommPop.do?wrkr_no=7961103104",
  address: "서울특별시 동대문구 고산자로 505, 2층 가17호(제기동)",
  phone: "010-9508-8855",
  email: "acttub0527@gmail.com",
  mailOrderReportNo: MAIL_ORDER_REPORT_NO,
} as const;

export function BusinessInfo({ tone = "light" }: { tone?: "light" | "dark" }) {
  const b = BUSINESS_INFO;
  const text = tone === "dark" ? "text-[#8b95a1]" : "text-[#8b95a1]";
  const link = tone === "dark" ? "hover:text-white" : "hover:text-[#191f28]";
  return (
    <div className={`text-xs leading-5 ${text}`}>
      <p>
        상호: {b.name} <span aria-hidden="true">|</span> 대표자: {b.representative}
      </p>
      <p>
        사업자등록번호: {b.registrationNo}{" "}
        <a
          href={b.registrationCheckUrl}
          target="_blank"
          rel="noreferrer"
          className={`underline underline-offset-2 ${link}`}
        >
          사업자정보 확인
        </a>
      </p>
      <p>통신판매업 신고번호: {b.mailOrderReportNo}</p>
      <p>사업장 주소: {b.address}</p>
      <p>
        전화: {b.phone} <span aria-hidden="true">|</span> 이메일:{" "}
        <a href={`mailto:${b.email}`} className={`underline underline-offset-2 ${link}`}>
          {b.email}
        </a>
      </p>
      <p>
        <a href="/help" className={`underline underline-offset-2 ${link}`}>고객센터</a>{" "}
        <span aria-hidden="true">|</span>{" "}
        <a href="/help/contact" className={`underline underline-offset-2 ${link}`}>문의하기</a>
      </p>
    </div>
  );
}
