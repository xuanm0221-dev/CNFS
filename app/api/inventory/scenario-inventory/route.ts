import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

const JSON_PATH = path.join(process.cwd(), '보조파일(simu)', 'scenario_inventory_closing.json');

export async function GET() {
  try {
    if (!fs.existsSync(JSON_PATH)) {
      return NextResponse.json({ error: '시나리오 재고 데이터 없음. 재고자산(sim) 탭에서 재계산 버튼을 눌러주세요.' }, { status: 404 });
    }
    const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `읽기 실패: ${msg}` }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: '프로덕션 환경에서는 저장할 수 없습니다.' }, { status: 403 });
  }
  try {
    const data = await request.json();
    fs.writeFileSync(JSON_PATH, JSON.stringify(data, null, 2), 'utf-8');
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `저장 실패: ${msg}` }, { status: 500 });
  }
}
