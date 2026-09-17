function loginRequired() {
  return Response.json(
    { error: '로그인 후에만 기록을 저장하고 조회할 수 있습니다.' },
    { status: 401 },
  );
}

export async function GET() { return loginRequired(); }

export async function POST() { return loginRequired(); }
