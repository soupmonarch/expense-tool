# 지출 증빙 · 변제 양식 자동 생성기

카드 사용 내역(.xls/.xlsx)을 업로드하면 회사 제출 양식에 맞춰 **Expense**와 **Travel** 두 개의 엑셀을 자동으로 만들어 줍니다. 카드사가 달라도 자동 인식하며, 애매한 항목은 팝업으로 물어보고 그 분류를 **모든 사용자에게 공유 누적**합니다.

## 핵심 기능

- **여러 카드사 자동 대응** — 헤더 키워드로 가맹점명/금액(원화)/업종명/국내·해외/취소여부/날짜·시간을 자동 인식.
- **규칙 우선 + AI 보조** — 공유 학습 → 업종명(MCC) → 가맹점 키워드 → AI 순으로 분류.
- **취소·환불 정산** — 취소 건을 원결제와 매칭해 순액(원결제−취소)을 한 행으로 기록. 금액이 똑같으면 전액취소로 보고 자동 제외, 금액이 다르면(부분취소·재결제 가능성) 팝업으로 확인.
- **항목별 검토 팝업** — 애매한 항목마다 분류를 고르고, **항목별로 학습 체크박스**를 끌 수 있습니다(일괄 · 개별 모두 가능).
- **결제대행업체 강제 수동분류** — ALIPAY, 네이버페이, 카카오페이, 토스, 페이코, PG사 등 결제대행사만 표시된 항목은 무엇을 샀는지 알 수 없으므로 **항상 팝업으로 물어보고, 체크해도 절대 학습하지 않습니다**.
- **제출 양식 자동 작성** — C(분류), H(금액), I(통화=KRW), O(Description=`날짜 / 가맹점명`)를 채우고 표 전체에 테두리 + 맑은 고딕 11pt + 가운데 정렬 적용.
- 해외 결제도 변제 금액은 항상 **원화(KRW)** 기준.

## 처리 흐름

1. 파일 업로드(드래그&드롭 또는 클릭) → **분류하기**
2. `POST /api/classify` 가 파싱 + 취소정산 + 분류 결과를 반환
3. 확인 팝업: ↩️ 취소·환불 확인(부분·전액·별개 선택) + 🯷 분류 확인(항목별 학습 체크)
4. **엑셀 다운로드** → `POST /api/generate` 가 Expense.xlsx + Travel.xlsx 를 ZIP으로 생성

## 취소·환불 처리 규칙

- 같은 가맹점의 원결제와 **금액이 일치**하는 취소 → 전액취소로 보고 둘 다 자동 제외(확인 불필요).
- 금액이 다른 취소 → 팝업으로 "이 결제 건의 취소가 맞나요?" 확인. 선택지:
  - **부분취소** → 원결제−취소 금액을 한 행으로 (예: 10,000 − 9,000 = 1,000)
  - **전액취소** → 해당 건 제외
  - **별개 건** → 원결제 그대로 유지
- 짝이 없는 취소(원결제 미포함) → 금액을 늘리지 않으므로 단순 제외.

## 분류 카테고리

- Expense(4): Courier and Postage Fees / Office Supplies / TELEPHONE EXPENSES / Business Entertainment Expenses
- Travel(9): Travel Allowance / (해외)Airfare·Accommodation·Other Transportation / (국내)Airfare·Accommodation·Parking and Toll·Other Transportation·Car Rental/Fuel
- 미분류 항목은 Expense 파일에 `UNCLASSIFIED`로 표시.

## 배포 (Vercel)

1. 이 폴더 내용을 GitHub 저장소에 업로드.
2. Vercel → Add New → Project → 저장소 Import (Next.js 자동 인식).
3. **Environment Variables**:
   - `OPENAI_API_KEY` (권장) / `OPENAI_MODEL=gpt-4o-mini`
   - 공유 학습용: Vercel → Storage → KV(Upstash Redis) 생성 후 Connect → `KV_REST_API_URL`/`KV_REST_API_TOKEN` 자동 주입
4. Deploy → URL을 사내에 공유.

환경변수가 없어도 동작합니다(키 없으면 미분류 표시, KV 없으면 학습이 임시 저장).

## 정확도 개선

- 운영 중 팝업에서 항목별로 학습을 체크하면 공유 저장소에 누적 → 이후 모두에게 자동 적용.
- 고정 규칙은 `lib/rules.ts`(`MCC_RULES`, `RULES`)에, 기타 결제대행사 명칭은 `lib/gateways.ts`의 `PAYMENT_GATEWAY_KEYWORDS`에 추가.
- 새 카드사 열 인식이 안 되면 `lib/parseStatement.ts`의 키워드 목록에 해당 카드사 열 이름을 추가.
