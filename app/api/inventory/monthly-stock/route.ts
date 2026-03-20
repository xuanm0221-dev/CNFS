import { NextRequest, NextResponse } from 'next/server';
import { CLOSED_THROUGH, fetchMonthlyStock } from '@/lib/inventory-db';
import { MonthlyStockResponse, MonthlyStockRow } from '@/lib/inventory-monthly-types';
import { get2025Cache, set2025Cache } from '@/lib/inventory-2025-cache';

function toYYMM(year: number, month: number): string {
  return `${year}${String(month).padStart(2, '0')}`;
}

function buildYyymmList(year: number, effectiveClosed: string) {
  const all: string[] = [
    toYYMM(year - 1, 12),
    ...Array.from({ length: 12 }, (_, i) => toYYMM(year, i + 1)),
  ];
  const queryable = all.filter((yymm) => yymm <= effectiveClosed);
  return { all, queryable };
}

function padRows(
  rows: MonthlyStockRow[],
  allYymms: string[],
  queryable: string[],
  includeFuture: boolean,
  effectiveClosed: string,
): MonthlyStockRow[] {
  const allMonths = allYymms.slice(1);
  const queryableMonths = queryable.slice(1);

  return rows.map((row) => ({
    ...row,
    monthly: allMonths.map((yymm) => {
      if (!includeFuture && yymm > effectiveClosed) return null;
      const idx = queryableMonths.indexOf(yymm);
      return idx >= 0 ? (row.monthly[idx] ?? null) : null;
    }),
  }));
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const year = parseInt(searchParams.get('year') ?? '2025', 10);
  const brand = searchParams.get('brand') ?? 'MLB';
  const onlyLatest = searchParams.get('onlyLatest') === 'true';
  const includeFuture = searchParams.get('includeFuture') === 'true';
  const effectiveClosed = searchParams.get('closedThrough') || CLOSED_THROUGH;

  // 2025년 캐시 확인 (onlyLatest/includeFuture 옵션 없는 일반 요청만 캐시)
  if (year === 2025 && !onlyLatest && !includeFuture) {
    const cached = await get2025Cache<MonthlyStockResponse>('monthly-stock', brand);
    if (cached) return NextResponse.json(cached);
  }

  const { all: allYymms, queryable: allQueryable } = buildYyymmList(year, effectiveClosed);
  const baseQueryable = includeFuture ? allYymms : allQueryable;
  const queryable = onlyLatest ? baseQueryable.slice(-1) : baseQueryable;

  if (queryable.length === 0) {
    return NextResponse.json({
      year,
      brand,
      closedThrough: effectiveClosed,
      dealer: { rows: [] },
      hq: { rows: [] },
    } satisfies MonthlyStockResponse);
  }

  try {
    const { dealer, hq } = await fetchMonthlyStock(queryable, brand, year);

    const response: MonthlyStockResponse = {
      year,
      brand,
      closedThrough: effectiveClosed,
      dealer: { rows: padRows(dealer.rows, allYymms, queryable, includeFuture, effectiveClosed) },
      hq: { rows: padRows(hq.rows, allYymms, queryable, includeFuture, effectiveClosed) },
    };

    // 2025년 일반 요청 결과 캐시에 저장
    if (year === 2025 && !onlyLatest && !includeFuture) {
      await set2025Cache('monthly-stock', brand, response);
    }

    return NextResponse.json(response);
  } catch (err) {
    console.error('[monthly-stock API] error:', err);
    return NextResponse.json(
      { error: '재고자산 데이터를 불러오는데 실패했습니다.' },
      { status: 500 },
    );
  }
}
