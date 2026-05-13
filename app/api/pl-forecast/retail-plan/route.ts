// PL(sim)에서 저장한 리테일 계획 (브랜드 × {대리상, 직영} × 12개월)
// 저장 위치: data/retail-plan.json — 매 저장 시 덮어쓰기
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FILE_PATH = path.join(process.cwd(), 'data', 'retail-plan.json');

type Brand = 'MLB' | 'MLB KIDS' | 'DISCOVERY' | 'DUVETICA' | 'SUPRA';

export interface RetailPlanBrand {
  dealer: (number | null)[];
  direct: (number | null)[];
}

export interface RetailPlanStore {
  year: number;
  savedAt: string;
  brands: Record<Brand, RetailPlanBrand>;
}

async function ensureDataDir(): Promise<void> {
  const dir = path.dirname(FILE_PATH);
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
}

export async function GET() {
  try {
    const buf = await fs.readFile(FILE_PATH, 'utf-8');
    const data = JSON.parse(buf) as RetailPlanStore;
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'ENOENT') {
      return NextResponse.json({ data: null }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `retail-plan.json 읽기 실패: ${message}` }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Partial<RetailPlanStore> | null;
    if (!body || !body.year || !body.brands) {
      return NextResponse.json({ error: '잘못된 본문: { year, brands } 필요' }, { status: 400 });
    }
    const store: RetailPlanStore = {
      year: body.year,
      savedAt: new Date().toISOString(),
      brands: body.brands as Record<Brand, RetailPlanBrand>,
    };
    await ensureDataDir();
    await fs.writeFile(FILE_PATH, JSON.stringify(store, null, 2), 'utf-8');
    return NextResponse.json({ success: true, savedAt: store.savedAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `retail-plan.json 저장 실패: ${message}` }, { status: 500 });
  }
}
