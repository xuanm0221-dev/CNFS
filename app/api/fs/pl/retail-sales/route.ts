// 손익계산서 PL용 리테일매출 — 연도별 5브랜드 × 4-leaf × 12개월
// 캐시는 lib/retail-pl-loader.ts 내부에서 관리 (12시간, 글로벌 in-memory)
import { NextResponse } from 'next/server';
import { fetchRetailSalesPLByYear } from '@/lib/retail-sales-pl-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const year = Number(url.searchParams.get('year') ?? '2026');
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      return NextResponse.json({ error: '유효한 year 파라미터가 필요합니다.' }, { status: 400 });
    }
    const data = await fetchRetailSalesPLByYear(year);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `리테일매출 조회 오류: ${message}` }, { status: 500 });
  }
}
