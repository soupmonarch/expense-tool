# 지출 증빙 · 변제 양식 자동 생성기

카드 사용 내역(.xls/.xlsx)을 업로드하면 회사 제출 양식에 맞춰 **Expense**와 **Travel** 두 개의 엑셀을 자동으로 만들어 줍니다. 카드사가 달라도 자동 인식하며, 애매한 항목은 팝업으로 물어보고 그 분류를 **모든 사용자에게 공유 누적**합니다.

## 핵심 기능

- **여러 카드사 자동 대응** — 열 위치를 고정하지 않고 헤더 키워드로 가맹점명/금액(원화)/업종명/국내·해외/취소 여부를 자동 인식.
- **규칙 우선 + AI 보조** — 업종명(MCC) → 가맹점 키워드 규칙 → AI 순으로 분류(무료·결정적 규칙을 먼저 쓰고, 남는 것만 AI 사용).
- **검토 팝업** — 애매하거나 미분류인 항목은 팝업이 떠서 적절한 분류를 묻습니다(AI 추천이 기본 선택).
- **공유 학습** — 사용자가 확정한 `가맹점 → 분류`는 서버(Vercel KV)에 저장되어, 이후 누가 올려도 자동 분류됩니다.
- **제출 양식 자동 작성** — C(분류), H(금액), I(통화=KRW), O(Description=`날짜 / 가맹점명`)를 채우고, 표 전체에 테두리 + 맑은 고딕 11pt + 가운데 정렬 적용.
- 해외 결제도 변제 금액은 항상 **원화(KRW)** 기준.

## 처리 흐름

1. 파일 업로드(드래그&드롭 또는 클릭) → **분류하기**
2. `POST /api/classify` 가 파싱 + 분류 결과(JSON)를 반환
3. 검토 필요한 항목이 있으면 팝업에서 분류 확인/수정 (+ 공유 저장)
4. **엑셀 다운로드** → `POST /api/generate` 가 Expense.xlsx + Travel.xlsx 를 ZIP으로 생성

## 분류 카테고리

- Expense(4): Courier and Postage Fees / Office Supplies / TELEPHONE EXPENSES / Business Entertainment Expenses
- Travel(9): Travel Allowance / (해외)Airfare·Accommodation·Other Transportation / (국내)Airfare·Accommodation·Parking and Toll·Other Transportation·Car Rental·Fuel
- 미분류 항목은 Expense 파일에 `UNCLASSIFIED`로 표시되어 누락 없이 검토 가능.

## 배포 (Vercel)

1. 이 폴더 내용을 GitHub 저장소에 업로드.
2. Vercel → Add New → Project → 저장소 Import (Next.js 자동 인식).
3. **Environment Variables** 설정:
   - `OPENAI_API_KEY` (권장) / `OPENAI_MODEL=gpt-4o-mini`
   - 공유 학습용: Vercel → Storage → **KV(Upstash Redis)** 생성 후 Connect → `KV_REST_API_URL`/`KV_REST_API_TOKEN` 자동 주입
4. Deploy → 생성된 URL을 사내에 공유.

환경변수가 없어도 동작합니다(키 없으면 미분류로 표시, KV 없으면 학습이 임시 저장).

## 정확도 개선

`lib/rules.ts` 의 키워드 표(`MCC_RULES`, `RULES`)에 항목을 추가하면 해당 가맹점은 이후 무료·즉시 분류됩니다. 또는 운영 중 팝업에서 확정하면 공유 학습으로 자동 축적됩니다.

## 새 카드사 추가 시

대부분 자동 인식되지만, 특정 양식이 안 잡히면 `lib/parseStatement.ts` 의 키워드 목록(`MERCHANT_KEYS`, `AMOUNT_PRIMARY_KEYS` 등)에 해당 카드사의 열 이름을 추가하세요.
