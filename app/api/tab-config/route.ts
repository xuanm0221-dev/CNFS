import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), 'public', 'data', 'tab-config.json');

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not allowed' }, { status: 405 });
  }
  try {
    const body = await request.json();
    await fs.writeFile(CONFIG_PATH, JSON.stringify(body, null, 2) + '\n', 'utf8');
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[tab-config] 저장 실패:', e);
    return NextResponse.json({ error: '파일 저장 실패' }, { status: 500 });
  }
}
