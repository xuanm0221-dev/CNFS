// 미해결 · 확인 필요 목록 (dev 전용)
//
// 상태 탭에서 읽고, 완료/되돌리기 토글로 status 만 바꾼다.
// 항목 추가는 data/dev-open-items.json 을 직접 편집해도 된다.
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FILE_PATH = path.join(process.cwd(), 'data', 'dev-open-items.json');

interface OpenItem {
  id: string;
  title: string;
  detail?: string;
  where?: string;
  since?: string;
  status: 'open' | 'done';
}

interface OpenItemsFile {
  items: OpenItem[];
  [key: string]: unknown;
}

async function readFileSafe(): Promise<OpenItemsFile> {
  try {
    const raw = await fs.readFile(FILE_PATH, 'utf-8');
    const json = JSON.parse(raw) as OpenItemsFile;
    return { ...json, items: Array.isArray(json.items) ? json.items : [] };
  } catch {
    return { items: [] };
  }
}

export async function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: '개발 모드에서만 사용 가능합니다.' }, { status: 403 });
  }
  const data = await readFileSafe();
  return NextResponse.json({ items: data.items }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: '개발 모드에서만 사용 가능합니다.' }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { id?: string; status?: 'open' | 'done' };
  if (!body.id || (body.status !== 'open' && body.status !== 'done')) {
    return NextResponse.json({ error: 'id 와 status(open|done) 가 필요합니다.' }, { status: 400 });
  }

  const data = await readFileSafe();
  const target = data.items.find((i) => i.id === body.id);
  if (!target) {
    return NextResponse.json({ error: `항목을 찾지 못했습니다: ${body.id}` }, { status: 404 });
  }
  target.status = body.status;

  // 원본의 다른 키(_설명 등)를 잃지 않도록 통째로 다시 쓴다
  await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  return NextResponse.json({ ok: true, items: data.items }, { headers: { 'Cache-Control': 'no-store' } });
}
