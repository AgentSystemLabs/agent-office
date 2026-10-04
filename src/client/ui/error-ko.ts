// Translate known application errors only. Repository content and agent output remain verbatim.
const MESSAGES: Readonly<Record<string, string>> = {
  'Wrong password': '비밀번호가 맞지 않습니다.',
  'Wrong name or password': '이름 또는 비밀번호가 맞지 않습니다.',
  'Wrong password. With an account of your own, type your name too.': '비밀번호가 맞지 않습니다. 개인 계정으로 로그인하려면 이름도 입력하세요.',
  'Sign in with your name and your own password': '내 계정의 이름과 비밀번호로 로그인하세요.',
  'Too many attempts. Try again in a few minutes.': '시도 횟수가 너무 많습니다. 몇 분 뒤 다시 시도하세요.',
  'Bad request': '요청을 처리할 수 없습니다.',
  'Not signed in': '로그인이 필요합니다.',
  'Admin only': '관리자만 사용할 수 있습니다.',
  'No such worker': '해당 직원을 찾을 수 없습니다.',
  'No such floor': '해당 프로젝트를 찾을 수 없습니다.',
  'This invite link has expired or was already used. Ask whoever sent it for a new one.': '이미 사용했거나 만료된 초대 링크입니다. 초대한 사람에게 새 링크를 요청하세요.',
  'This office has already been claimed. Sign in with the password you saved.': '초기 설정이 끝난 사무실입니다. 저장한 비밀번호로 로그인하세요.',
  'That claim link is not valid.': '유효하지 않은 초기 설정 링크입니다.',
  'That sign-in link was already used. Sign in with the office password.': '이미 사용한 로그인 링크입니다. 사무실 비밀번호로 로그인하세요.',
};

export function localizeError(message: string): string {
  return MESSAGES[message] ?? message;
}
