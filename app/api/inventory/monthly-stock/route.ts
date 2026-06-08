import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { CLOSED_THROUGH, fetchMonthlyStock } from '@/lib/inventory-db';
import { MonthlyStockResponse, MonthlyStockRow } from '@/lib/inventory-monthly-types';
import { get2025Cache, set2025Cache } from '@/lib/inventory-2025-cache';

export const dynamic = 'force-dynamic';

/**
 * Precomputed JSON 의 closedThrough 읽기 — 사용자가 마지막으로 전처리한 월.
 * 라이브 API 도 precomputed JSON 과 동일 closedThrough 사용 → 헤더 (F) 일관성 유지.
 * Snowflake 의 부분 월 데이터(오늘 날짜까지 누적된 잔액)에 휘둘리지 않도록.
 */
function readPrecomputedClosedThrough(year: number, brand: string): string | null {
  try {
    const safeBrand = brand.replace(/\s+/g, '_');
    const filePath = path.join(
      process.cwd(),
      'public',
      'data',
      'inventory',
      String(year),
      `monthly-stock-${safeBrand}.json`,
    );
    if (!fs.existsSync(filePath)) return null;
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { closedThrough?: string };
    return content.closedThrough ?? null;
  } catch {
    return null;
  }
}

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
  // effectiveClosed 우선순위:
  //   1) 클라이언트 명시 closedThrough
  //   2) precomputed JSON 의 closedThrough (= 사용자 마지막 refresh 스크립트 baseMonth)
  //   3) CLOSED_THROUGH 상수 (fallback)
  const clientClosed = searchParams.get('closedThrough');
  const precomputedClosed = year === 2026 ? readPrecomputedClosedThrough(year, brand) : null;
  const effectiveClosed = clientClosed || precomputedClosed || CLOSED_THROUGH;

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
