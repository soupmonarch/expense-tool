# 지출 증빙·변제 양식 자동 생성기 (Expense Claim Generator)

카드 사용 내역(.xls / .xlsx)을 업로드하면 회사 제출 양식에 맞춘 **Expense.xlsx**와
**Travel.xlsx** 두 개를 자동으로 채워서 ZIP으로 내려받는 웹앱입니다. 전 지사가
링크 하나로 사용할 수 있도록 Vercel 배포를 전제로 만들어졌습니다.

## 동작 방식 (규칙표 우선 + 신규만 AI)

1. 업로드된 카드 내역에서 가맹점/금액/통화 열을 자동 인식합니다. (`lib/parseStatement.ts`)
2. **규칙표**(`lib/rules.ts`)로 대부분의 거래를 결정적으로 분류합니다. (무료·일관성)
3. 규칙으로 못 맞춘 거래만 **OpenAI**로 분류합니다. (`lib/classify.ts`)
   - API 키가 없으면 해당 행은 `UNCLASSIFIED`로 표시되어 빠지지 않고 사람이 확인할 수 있습니다.
4. 공식 양식 템플릿(`templates/form_template.xlsx`)의 노란색 열만 채웁니다.
   - **C열** = Expense category, **H열** = Total amount, **I열** = Currency (4행 헤더, 5행부터 데이터)
5. Expense/Travel 두 파일 + 분류 근거(`classification_report.json`)를 ZIP으로 반환합니다.

해외/국내 구분(항공·숙박·교통)은 거래 **통화가 KRW가 아니면 해외**로 자동 판정합니다.

## 로컬 실행

```bash
npm install
cp .env.example .env.local   # OPENAI_API_KEY 입력 (선택)
npm run dev                  # http://localhost:3000
```

## Vercel 배포

1. 이 폴더를 GitHub 저장소에 올립니다.
2. Vercel에서 New Project → 해당 저장소 import.
3. Environment Variables에 `OPENAI_API_KEY` (및 선택적으로 `OPENAI_MODEL`) 추가.
4. Deploy. 생성된 URL을 전 지사에 공유하면 됩니다.

> `templates/form_template.xlsx` 는 저장소에 포함되어 함께 배포됩니다. 양식이 바뀌면
> 이 파일만 교체하세요.

## 분류 정확도 높이기

- 가맹점이 새로 나올 때마다 `lib/rules.ts` 의 keywords 배열에 추가하면
  AI 호출 없이 즉시·정확하게 분류됩니다. 시간이 지날수록 규칙표가 두꺼워져
  AI 비용은 0에 수렴합니다.
- 카테고리 후보는 `lib/categories.ts` 에 공식 목록 그대로 정의되어 있습니다.
  여기 있는 문자열과 **정확히 일치**해야 회사 import 검증을 통과합니다.

## 카드 내역 열 자동 인식

가맹점/금액/통화/일자 열은 헤더 키워드로 자동 인식합니다(한글·영문 모두 지원).
발급사 양식이 특이해서 인식이 안 되면 `app/api/convert/route.ts` 가 받는
`col_merchant`, `col_amount`, `col_currency`, `col_date` (0-based 인덱스)로
수동 매핑을 넘길 수 있습니다. (UI 확장 포인트)

## 한계 / 메모

- ExcelJS 로 템플릿을 다시 저장하므로 드롭다운(데이터 유효성) 일부가 사라질 수
  있습니다. 채워지는 값 자체는 공식 카테고리 문자열이라 제출에는 문제 없습니다.
- 일부 카드사 .xls 는 실제로는 HTML 표 형식입니다. 대부분 파싱되지만, 안 되면
  .xlsx 로 다시 저장 후 업로드하세요.
- Travel Allowance(여비/일비)는 보통 카드결제가 아니라 수기 입력 항목이라 자동
  분류 대상이 거의 없습니다.
