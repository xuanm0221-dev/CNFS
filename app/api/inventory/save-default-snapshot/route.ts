// 기본 시나리오 스냅샷 저장 (dev 전용)
// POST body → 보조파일(simu)/scenario_inventory_closing.json 에 직접 덮어쓰기
// (브라우저 다운로드 → ~/Downloads → 수동 이동 단계를 제거)
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // 개발 환경 외에는 거부 (Vercel deployed 환경에서는 filesystem 읽기 전용이고,
  // 의도적으로도 production에서는 이 동작이 일어나선 안 됨)
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { error: '개발 모드에서만 사용 가능합니다.' },
      { status: 403 },
    );
  }

  try {
    const body = (await req.json()) as unknown;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'JSON body가 필요합니다.' }, { status: 400 });
    }

    const filePath = path.join(process.cwd(), '보조파일(simu)', 'scenario_inventory_closing.json');
    const content = JSON.stringify(body, null, 2);
    await fs.writeFile(filePath, content, 'utf-8');

    return NextResponse.json({
      success: true,
      filePath: path.relative(process.cwd(), filePath).split(path.sep).join('/'),
      bytes: Buffer.byteLength(content, 'utf-8'),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[save-default-snapshot] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
