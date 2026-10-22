import { T } from "@/lib/theme";
import type { CSSProperties, ReactNode } from "react";
import { LogoMark } from "@/components/Logo";

// 사용 설명서(웹 버전). 화면 사진은 public/guide/ 에 있고, 모두 가짜 예시 데이터로 찍은 것이다.
// 화면이 바뀌면 사진을 다시 찍어 같은 이름으로 덮어쓰면 된다.

const TOC: [string, string][] = [
  ["prepare", "준비하기"],
  ["upload", "파일 올리기"],
  ["reader", "영수증 읽기 방식"],
  ["review", "검토하기"],
  ["download", "다운로드"],
  ["cancel", "취소·환불 처리"],
  ["learned", "학습 데이터"],
  ["faq", "자주 묻는 질문"],
];

export default function GuidePage() {
  return (
    <main style={wrap}>
      <div style={card}>
        <a href="/" style={back}>
          ← 메인으로
        </a>

        {/* 첫머리 */}
        <header style={hero}>
          <LogoMark size={44} />
          <div>
            <h1 style={title}>사용 설명서</h1>
            <p style={lead}>
              카드 승인내역과 영수증 PDF만 올리면 <b>Expense·Travel 제출 양식</b>과{" "}
              <b>순서대로 정리된 영수증 PDF</b>가 만들어져요. 처음이라도 3분이면 충분해요.
            </p>
          </div>
        </header>

        <div style={flow}>
          {["파일 올리기", "검토", "다운로드"].map((s, i) => (
            <div key={s} style={flowStep}>
              <span style={flowNum}>{i + 1}</span>
              <span>{s}</span>
              {i < 2 && <span style={flowArrow}>→</span>}
            </div>
          ))}
        </div>

        <nav style={toc} aria-label="목차">
          {TOC.map(([id, label], i) => (
            <a key={id} href={`#${id}`} style={tocLink}>
              <span style={tocNum}>{i + 1}</span>
              {label}
            </a>
          ))}
        </nav>

        <p style={note}>
          ※ 아래 화면 사진은 모두 <b>가짜 예시 데이터</b>로 찍었어요. 실제 화면과 숫자·이름만 달라요.
        </p>

        {/* 1. 준비하기 */}
        <Section id="prepare" n={1} title="준비하기">
          <p style={p}>카드사 홈페이지나 앱에서 제출할 기간의 파일 두 가지를 내려받아 주세요.</p>
          <div style={twoCol}>
            <div style={fileCard}>
              <span style={{ ...fileBadge, background: "#1e7d45" }}>XLS</span>
              <div>
                <b>카드 승인내역</b>
                <div style={muted}>.xlsx · .xls · .csv</div>
              </div>
            </div>
            <div style={fileCard}>
              <span style={{ ...fileBadge, background: "#c0392b" }}>PDF</span>
              <div>
                <b>영수증(매출전표) PDF</b>
                <div style={muted}>카드사에서 발급한 전표</div>
              </div>
            </div>
          </div>
          <Tip>
            파일이 여러 개여도 괜찮아요. 기간이 겹쳐서 같은 결제가 두 번 들어가도 <b>중복은 자동으로 빠져요.</b>
          </Tip>
        </Section>

        {/* 2. 파일 올리기 */}
        <Section id="upload" n={2} title="파일 올리기">
          <p style={p}>먼저 위쪽 세 버튼 중에서 가지고 있는 파일에 맞는 방식을 고르세요.</p>
          <table style={table}>
            <tbody>
              <tr>
                <td style={tdHead}>엑셀 + 영수증</td>
                <td style={td}>
                  <b>가장 추천.</b> 엑셀로 분류하고, 영수증을 엑셀 순서에 맞춰 붙여 줘요.
                </td>
              </tr>
              <tr>
                <td style={tdHead}>영수증 PDF만</td>
                <td style={td}>엑셀이 없을 때. 영수증에서 날짜·가맹점·금액을 읽어서 분류해요.</td>
              </tr>
              <tr>
                <td style={tdHead}>엑셀만</td>
                <td style={td}>영수증 없이 양식(엑셀)만 필요할 때.</td>
              </tr>
            </tbody>
          </table>
          <p style={p}>
            파일을 점선 칸에 <b>끌어다 놓거나</b> 칸을 눌러 선택한 뒤, 맨 아래 <b>분류하기</b>를 누르면 끝이에요.
          </p>
          <Shot src="/guide/01-upload.webp" w={1368} h={1734} narrow>
            첫 화면 — 엑셀과 영수증 PDF를 올린 모습
          </Shot>
        </Section>

        {/* 3. 영수증 읽기 방식 */}
        <Section id="reader" n={3} title="영수증 읽기 방식">
          <p style={p}>
            영수증은 기본으로 <b>AI가 읽어요.</b> 보라색 칸에 지금 쓰는 AI 모델 이름이 표시돼요. 스캔하거나
            인쇄한 PDF, 처음 보는 양식도 잘 읽어요.
          </p>
          <Shot src="/guide/07-reader.webp" w={1344} h={398}>
            AI 읽기 안내와 &lsquo;더보기 → OCR로 인식하기&rsquo;
          </Shot>
          <ul style={ul}>
            <li>
              영수증 그림은 읽기 위해 OpenAI로 전송돼요. 같은 파일을 다시 올리면 저장해 둔 결과를 써서 다시 보내지
              않아요.
            </li>
            <li>
              영수증을 밖으로 보내고 싶지 않다면 <b>더보기 → OCR로 인식하기</b>를 체크하세요. 내 컴퓨터 안에서
              글자를 읽어요(무료). 대신 가맹점명이 가끔 틀릴 수 있어요.
            </li>
            <li>한 번 고른 방식은 다음에 들어와도 기억돼요.</li>
          </ul>
        </Section>

        {/* 4. 검토하기 */}
        <Section id="review" n={4} title="검토하기">
          <p style={p}>
            분류가 끝나면 <b>검토 창</b>이 바로 열려요. 이 창에 보이는 그대로 엑셀이 만들어지니, 여기서 한 번만
            확인하면 돼요.
          </p>
          <Shot src="/guide/02-review.webp" w={2256} h={1626}>
            검토 창 — 왼쪽은 요약·확인할 항목·전체 목록, 오른쪽은 고른 줄에 붙을 영수증
          </Shot>
          <ul style={ul}>
            <li>
              <b>맨 위 요약:</b> Expense·Travel 건수와 금액, 영수증이 몇 건 짝지어졌는지 보여줘요.
            </li>
            <li>
              <b>빨간 안내:</b> 아직 분류를 안 고른 항목이 있다는 뜻이에요. 그대로 받으면 UNCLASSIFIED로 들어가요.
            </li>
            <li>
              <b>오른쪽 영수증:</b> 왼쪽 목록에서 줄을 누르면 그 줄에 붙을 영수증이 보여요.
            </li>
          </ul>

          <h3 style={h3}>① 확인 필요 항목 정리하기</h3>
          <p style={p}>노란 테두리 칸에 사람이 직접 봐야 하는 항목만 모여 있어요. 이런 경우에 나와요.</p>
          <table style={table}>
            <tbody>
              <tr>
                <td style={tdHead}>결제대행사</td>
                <td style={td}>
                  네이버페이·ALIPAY처럼 결제대행사 이름만 찍혀서 무엇을 샀는지 알 수 없는 결제. 매번 직접 골라야
                  해요.
                </td>
              </tr>
              <tr>
                <td style={tdHead}>처음 보는 가맹점</td>
                <td style={td}>규칙에도, 학습 데이터에도 없고 AI도 확신하지 못한 가맹점.</td>
              </tr>
              <tr>
                <td style={tdHead}>AI 자동 분류</td>
                <td style={td}>AI가 분류한 항목. 맞으면 그대로 두고, 틀린 것만 바꾸세요.</td>
              </tr>
              <tr>
                <td style={tdHead}>취소·환불</td>
                <td style={td}>짝이 되는 원결제를 확실히 찾지 못한 취소·환불 (6번 참고).</td>
              </tr>
              <tr>
                <td style={tdHead}>읽지 못한 영수증</td>
                <td style={td}>영수증에서 금액·가맹점을 못 읽었을 때. 노란 칸에 직접 입력해 주세요.</td>
              </tr>
            </tbody>
          </table>
          <Shot src="/guide/03-needs-check.webp" w={1224} h={1414} narrow>
            확인 필요 항목 — 결제대행사, 처음 보는 가맹점, AI 자동 분류
          </Shot>

          <h3 style={h3}>② 분류 고르기</h3>
          <p style={p}>
            <b>분류를 골라 주세요</b>를 누르면 목록이 펼쳐져요. 왼쪽 파란 칸이 <b style={{ color: T.expense }}>Expense</b>,
            오른쪽 주황 칸이 <b style={{ color: T.travel }}>Travel</b>이에요. 위쪽 검색창에 &lsquo;택시&rsquo;,
            &lsquo;주차&rsquo;처럼 한글로 찾거나, 자주 쓰는 분류를 바로 눌러도 돼요.
          </p>
          <Shot src="/guide/04-picker.webp" w={1172} h={1166} narrow>
            분류 선택 — 검색, 자주 쓰는 분류, Expense / Travel 두 칸
          </Shot>
          <Tip>
            같은 가맹점이 여러 건이면 하나만 골라도 <b>함께 바뀌어요</b> (결제대행사는 건마다 따로 골라요).
          </Tip>

          <h3 style={h3}>③ 체크박스의 뜻</h3>
          <div style={checkGrid}>
            <div style={checkCard}>
              <div style={checkTitle}>☑ 이 분류를 모두에게 저장</div>
              <div style={muted}>
                기본으로 체크돼 있어요. 다운로드할 때 저장되고, <b>회사 모든 사람</b>이 다음부터 이 가맹점을 자동으로
                분류받아요.
              </div>
            </div>
            <div style={checkCard}>
              <div style={checkTitle}>☐ 이 가맹점은 결제대행사입니다</div>
              <div style={muted}>
                결제대행사인데 도구가 몰랐다면 체크해 주세요. 다음부터는 자동 분류하지 않고 매번 확인을 요청해요.
              </div>
            </div>
          </div>
          <Warn>저장한 분류는 모두에게 적용돼요. 확실하지 않으면 &lsquo;모두에게 저장&rsquo; 체크를 풀어 주세요.</Warn>

          <h3 style={h3}>④ 전체 목록 확인</h3>
          <p style={p}>
            아래로 내리면 Expense·Travel 전체 목록이 있어요. 여기서도 분류를 바꿀 수 있고, 줄마다 영수증이 짝지어졌는지
            표시돼요.
          </p>
          <div style={twoShots}>
            <Shot src="/guide/05-list-expense.webp" w={1224} h={978}>
              Expense 목록
            </Shot>
            <Shot src="/guide/05-list-travel.webp" w={1224} h={614}>
              Travel 목록
            </Shot>
          </div>
          <ul style={ul}>
            <li>
              <b style={{ color: T.success }}>🧾 영수증 매칭됨</b> — 이 줄의 영수증이 영수증 PDF에 순서대로 들어가요.
            </li>
            <li>
              <b style={{ color: T.warning }}>⚠️ 영수증 없음</b> — 영수증 PDF에서 이 줄은 빠져요. 빠진 영수증을 추가로
              첨부해 주세요.
            </li>
          </ul>
        </Section>

        {/* 5. 다운로드 */}
        <Section id="download" n={5} title="다운로드">
          <p style={p}>
            빨간 항목이 모두 없어지면 검토 창 아래에 <b>이름</b>을 적고 <b>확인 완료 · 다운로드</b>를 누르세요. 이름은
            이용 기록에 남고, 한 번 적으면 기억돼요.
          </p>
          <Shot src="/guide/06-review-done.webp" w={2256} h={1626}>
            분류를 모두 고른 뒤 — 오른쪽 아래 버튼으로 다운로드
          </Shot>
          <p style={p}>
            <b>expense_claims.zip</b> 파일 하나가 내려받아지고, 압축을 풀면 이렇게 들어 있어요.
          </p>
          <div style={zipGrid}>
            <ZipFile badge="XLS" color="#1e7d45" name="Expense.xlsx" desc="Expense 제출 양식" />
            <ZipFile badge="XLS" color="#1e7d45" name="Travel.xlsx" desc="Travel 제출 양식" />
            <ZipFile badge="PDF" color="#c0392b" name="Expense_Receipts.pdf" desc="Expense 영수증 (엑셀 순서)" />
            <ZipFile badge="PDF" color="#c0392b" name="Travel_Receipts.pdf" desc="Travel 영수증 (엑셀 순서)" />
            <ZipFile badge="TXT" color="#5f6873" name="영수증_리포트.txt" desc="짝짓기 결과·빠진 영수증" />
          </div>
          <Tip>
            엑셀의 줄 순서와 영수증 PDF의 페이지 순서가 같아요. 제출 전에 두 양식을 한 번씩 열어 확인해 주세요.
          </Tip>
          <p style={p}>
            검토 창을 닫았다면 첫 화면에 요약이 남아 있어요. <b>검토하기</b>를 누르면 다시 열 수 있어요.
          </p>
          <Shot src="/guide/08-summary.webp" w={1304} h={440}>
            검토 창을 닫았을 때 보이는 요약
          </Shot>
        </Section>

        {/* 6. 취소·환불 */}
        <Section id="cancel" n={6} title="취소·환불은 이렇게 처리돼요">
          <table style={table}>
            <tbody>
              <tr>
                <td style={tdHead}>전액 취소</td>
                <td style={td}>원결제와 취소를 짝지어 둘 다 빼요. 청구하지 않아요.</td>
              </tr>
              <tr>
                <td style={tdHead}>부분 취소</td>
                <td style={td}>
                  남은 금액만 청구해요. 예) 호텔 132,000원 − 환불 32,000원 = <b>100,000원</b>
                </td>
              </tr>
              <tr>
                <td style={tdHead}>원결제가 없는 환불</td>
                <td style={td}>
                  이번 내역에 원결제가 없으면 물어봐요. <b>제외</b>(청구 안 함) 또는 <b>음수로 포함</b> 중에서
                  고르세요.
                </td>
              </tr>
              <tr>
                <td style={tdHead}>짝이 애매할 때</td>
                <td style={td}>승인번호가 달라 추정한 짝이면 &lsquo;이 결제의 취소가 맞나요?&rsquo;라고 확인해요.</td>
              </tr>
            </tbody>
          </table>
        </Section>

        {/* 7. 학습 데이터 */}
        <Section id="learned" n={7} title="학습 데이터">
          <p style={p}>
            위쪽 <b>학습 데이터</b> 메뉴에서 지금까지 저장된 &lsquo;가맹점 → 분류&rsquo;를 모두 볼 수 있어요. 검색,
            직접 추가·수정·삭제, 결제대행사로 옮기기, CSV 내보내기가 돼요.
          </p>
          <Shot src="/guide/09-learned.webp" w={1848} h={1800}>
            학습 데이터 화면 (예시)
          </Shot>
          <Warn>여기서 고친 내용도 회사 모든 사람에게 바로 적용돼요.</Warn>
        </Section>

        {/* 8. FAQ */}
        <Section id="faq" n={8} title="자주 묻는 질문">
          <Faq q="'영수증 없음'이라고 떠요.">
            그 결제의 영수증이 올린 PDF에 없거나, 영수증의 승인번호·금액이 엑셀과 달라서 짝을 못 찾은 거예요. 빠진
            영수증 PDF를 추가로 첨부하면 다시 짝지어 줘요. 어느 줄과도 맞지 않은 영수증은 검토 창에 따로 표시돼요.
          </Faq>
          <Faq q="분류를 안 고르고 받으면 어떻게 돼요?">
            Expense 파일에 UNCLASSIFIED로 들어가요. 제출 전에 꼭 골라 주세요.
          </Faq>
          <Faq q="창을 실수로 닫았어요.">
            다시 들어오면 첫 화면에 &lsquo;이전 작업이 있습니다&rsquo;가 떠요. <b>이어하기</b>를 누르면 돼요. 영수증
            PDF는 브라우저에 저장되지 않으니, 영수증까지 받으려면 같은 PDF를 다시 첨부해 주세요.
          </Faq>
          <Faq q="AI로 영수증을 읽으면 비용이나 보안은요?">
            영수증 한 장에 약 1원 정도예요. 영수증 그림이 OpenAI로 전송되니, 원하지 않으면 &lsquo;더보기 → OCR로
            인식하기&rsquo;를 쓰세요.
          </Faq>
          <Faq q="엑셀 양식을 못 읽는대요.">
            가맹점명·금액 열이 있는 카드사 원본 파일인지 확인해 주세요. 엑셀을 직접 편집해 열 이름을 바꾸면 못 읽을 수
            있어요.
          </Faq>
          <Faq q="오류를 발견했어요.">
            첫 화면 맨 아래 <b>버그·오류 제보</b>의 WeChat ID로 화면 사진과 함께 알려 주세요.
          </Faq>
        </Section>

        <div style={footer}>
          <a href="/" style={primaryBtn}>
            지금 시작하기 →
          </a>
          <a href="/changelog" style={footLink}>
            업데이트 이력 보기
          </a>
        </div>
      </div>
    </main>
  );
}

function Section({ id, n, title, children }: { id: string; n: number; title: string; children: ReactNode }) {
  return (
    <section id={id} style={section}>
      <h2 style={h2}>
        <span style={h2Num}>{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Shot({
  src,
  w,
  h,
  narrow,
  children,
}: {
  src: string;
  w: number;
  h: number;
  narrow?: boolean;
  children: ReactNode;
}) {
  return (
    <figure style={{ ...figure, maxWidth: narrow ? 520 : "100%" }}>
      <a href={src} target="_blank" rel="noopener noreferrer" title="크게 보기">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} width={w} height={h} alt={String(children)} loading="lazy" style={img} />
      </a>
      <figcaption style={caption}>{children}</figcaption>
    </figure>
  );
}

function Tip({ children }: { children: ReactNode }) {
  return <div style={tip}>💡 {children}</div>;
}

function Warn({ children }: { children: ReactNode }) {
  return <div style={warn}>⚠️ {children}</div>;
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details style={faq}>
      <summary style={faqQ}>{q}</summary>
      <div style={faqA}>{children}</div>
    </details>
  );
}

function ZipFile({ badge, color, name, desc }: { badge: string; color: string; name: string; desc: string }) {
  return (
    <div style={fileCard}>
      <span style={{ ...fileBadge, background: color }}>{badge}</span>
      <div style={{ minWidth: 0 }}>
        <b style={{ fontSize: 13.5, wordBreak: "break-all" }}>{name}</b>
        <div style={muted}>{desc}</div>
      </div>
    </div>
  );
}

const wrap: CSSProperties = { minHeight: "100vh", display: "flex", justifyContent: "center", padding: 24 };
const card: CSSProperties = {
  width: "100%",
  maxWidth: 820,
  background: T.surface,
  borderRadius: 16,
  padding: "28px 32px 36px",
  boxShadow: T.shadow,
  alignSelf: "flex-start",
};
const back: CSSProperties = { fontSize: 13, color: T.primary, textDecoration: "none", fontWeight: 600 };
const hero: CSSProperties = { display: "flex", gap: 14, alignItems: "flex-start", margin: "18px 0 18px" };
const title: CSSProperties = { fontSize: 24, margin: "2px 0 6px", letterSpacing: -0.4 };
const lead: CSSProperties = { fontSize: 14.5, color: T.textSub, lineHeight: 1.7, margin: 0 };
const flow: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  padding: "12px 16px",
  background: T.surfaceAlt,
  borderRadius: T.radius,
  fontSize: 14,
  fontWeight: 600,
  color: T.text,
};
const flowStep: CSSProperties = { display: "flex", alignItems: "center", gap: 8 };
const flowNum: CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 11,
  background: T.primary,
  color: "#fff",
  fontSize: 12,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};
const flowArrow: CSSProperties = { color: T.textFaint, margin: "0 4px" };
const toc: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, margin: "16px 0 10px" };
const tocLink: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px",
  border: `1px solid ${T.border}`,
  borderRadius: 999,
  fontSize: 13,
  color: T.textSub,
  textDecoration: "none",
  background: T.surface,
};
const tocNum: CSSProperties = { color: T.primary, fontWeight: 700 };
const note: CSSProperties = { fontSize: 12.5, color: T.textFaint, margin: "4px 0 0" };
const section: CSSProperties = {
  borderTop: `1px solid ${T.divider}`,
  marginTop: 28,
  paddingTop: 22,
  scrollMarginTop: 16,
};
const h2: CSSProperties = { fontSize: 19, margin: "0 0 12px", display: "flex", alignItems: "center", gap: 10 };
const h2Num: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  background: T.primaryBg,
  color: T.primary,
  border: `1px solid ${T.primaryBorder}`,
  fontSize: 14,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};
const h3: CSSProperties = { fontSize: 15.5, margin: "26px 0 8px", color: T.text };
const p: CSSProperties = { fontSize: 14, color: T.textSub, lineHeight: 1.75, margin: "8px 0" };
const ul: CSSProperties = { margin: "8px 0", paddingLeft: 20, fontSize: 14, color: T.textSub, lineHeight: 1.8 };
const muted: CSSProperties = { fontSize: 12.5, color: T.textMuted, lineHeight: 1.6, marginTop: 2 };
const twoCol: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 10,
  margin: "10px 0",
};
const fileCard: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "12px 14px",
  border: `1px solid ${T.border}`,
  borderRadius: T.radius,
  fontSize: 14,
  color: T.text,
};
const fileBadge: CSSProperties = {
  color: "#fff",
  fontSize: 11,
  fontWeight: 800,
  borderRadius: 6,
  padding: "6px 7px",
  flexShrink: 0,
  letterSpacing: 0.3,
};
const zipGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
  gap: 10,
  margin: "10px 0",
};
const table: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13.5, margin: "10px 0" };
const tdHead: CSSProperties = {
  padding: "10px 12px",
  borderBottom: `1px solid ${T.divider}`,
  fontWeight: 700,
  color: T.text,
  whiteSpace: "nowrap",
  verticalAlign: "top",
  width: 1,
};
const td: CSSProperties = {
  padding: "10px 12px",
  borderBottom: `1px solid ${T.divider}`,
  color: T.textSub,
  lineHeight: 1.6,
};
const figure: CSSProperties = { margin: "14px auto 6px" };
const img: CSSProperties = {
  display: "block",
  width: "100%",
  height: "auto",
  borderRadius: 12,
  border: `1px solid ${T.border}`,
  boxShadow: "0 6px 24px rgba(20,30,50,0.08)",
};
const caption: CSSProperties = { fontSize: 12.5, color: T.textFaint, textAlign: "center", marginTop: 8 };
const twoShots: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 14,
  alignItems: "start",
};
const tip: CSSProperties = {
  background: T.primaryBg,
  border: `1px solid ${T.primaryBorder}`,
  color: T.textSub,
  borderRadius: T.radius,
  padding: "10px 14px",
  fontSize: 13.5,
  lineHeight: 1.7,
  margin: "12px 0",
};
const warn: CSSProperties = {
  ...tip,
  background: T.warningBg,
  border: `1px solid ${T.warningBorder}`,
  color: T.warningText,
};
const checkGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 10,
  margin: "10px 0",
};
const checkCard: CSSProperties = {
  border: `1px solid ${T.border}`,
  borderRadius: T.radius,
  padding: "12px 14px",
};
const checkTitle: CSSProperties = { fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 4 };
const faq: CSSProperties = {
  border: `1px solid ${T.border}`,
  borderRadius: T.radius,
  padding: "12px 14px",
  margin: "8px 0",
};
const faqQ: CSSProperties = { fontSize: 14, fontWeight: 700, color: T.text, cursor: "pointer" };
const faqA: CSSProperties = { fontSize: 13.5, color: T.textSub, lineHeight: 1.75, marginTop: 8 };
const footer: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  flexWrap: "wrap",
  borderTop: `1px solid ${T.divider}`,
  marginTop: 32,
  paddingTop: 22,
};
const primaryBtn: CSSProperties = {
  background: T.primary,
  color: "#fff",
  borderRadius: T.radius,
  padding: "11px 20px",
  fontSize: 14,
  fontWeight: 700,
  textDecoration: "none",
};
const footLink: CSSProperties = { fontSize: 13.5, color: T.primary, textDecoration: "none", fontWeight: 600 };
