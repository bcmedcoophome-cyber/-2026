export async function POST() {
  return Response.json(
    { error: '로그인 후에만 기록을 저장할 수 있습니다.' },
    { status: 401 },
  );
}
