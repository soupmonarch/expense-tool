// 브라우저 전용: 이 브라우저를 구분하는 기기 ID.
// 사무실처럼 여러 사람이 같은 IP로 접속하면 IP만으로는 사람을 구분할 수 없어서,
// 처음 접속할 때 무작위 ID를 만들어 브라우저에 저장해 두고 이용 기록에 함께 남긴다.
// (브라우저 데이터를 지우거나 다른 PC·브라우저를 쓰면 새 ID가 된다)
const KEY = "expense_tool_device_id";

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id =
        Date.now().toString(36).slice(-4) +
        Math.random().toString(36).slice(2, 10);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}
