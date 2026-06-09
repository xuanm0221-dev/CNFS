// 누적원가율 — Snowflake 직접 조회 API (전처리 스크립트 전용)
// 사용자가 `python scripts/refresh_2026_cumulative_cost_rate.py --baseMonth N` 실행 시 호출
// 결과는 표시용 API (../cumulative-cost-rate/route.ts) 가 읽는 CSV 로 스크립트가 저장
import { NextRequest, NextResponse } from 'next/server';
import { fetchCumulativeCostRate } from '@/lib/cumulative-cost-rate-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const baseYearRaw = req.nextUrl.searchParams.get('baseYear') ?? '2026';
    const baseMonthRaw = req.nextUrl.searchParams.get('baseMonth') ?? '5';
    const baseYear = Number(baseYearRaw);
    const baseMonth = Number(baseMonthRaw);

    if (!Number.isInteger(baseYear) || baseYear < 2024 || baseYear > 2100) {
      return NextResponse.json({ error: 'baseYear 가 유효하지 않습니다.' }, { status: 400 });
    }
    if (!Number.isInteger(baseMonth) || baseMonth < 1 || baseMonth > 12) {
      return NextResponse.json({ error: 'baseMonth 는 1~12 사이여야 합니다.' }, { status: 400 });
    }

    const result = await fetchCumulativeCostRate(baseYear, baseMonth);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `누적원가율 Snowflake 조회 오류: ${message}` }, { status: 500 });
  }
}
