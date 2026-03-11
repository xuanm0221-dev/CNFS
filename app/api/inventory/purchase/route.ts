import { NextRequest, NextResponse } from 'next/server';
import { CLOSED_THROUGH } from '@/lib/inventory-db';
import { fetchPurchaseSales } from '@/lib/purchase-db';
import { RetailSalesTableData, RetailSalesRow } from '@/lib/retail-sales-types';
import { get2025Cache, set2025Cache } from '@/lib/inventory-2025-cache';

export interface PurchaseResponse {
  year: number;
  brand: string;
  closedThrough: string;
  data: RetailSalesTableData;
}

function toYYMM(year: number, month: number): string {
  return `${year}${String(month).padStart(2, '0')}`;
}

function buildYyymmList(year: number) {
  const all: string[] = Array.from({ length: 12 }, (_, i) => toYYMM(year, i + 1));
  const queryable = all.filter((yymm) => yymm <= CLOSED_THROUGH);
  return { all, queryable };
}

function padRows(
  rows: RetailSalesRow[],
  allYymms: string[],
  queryable: string[],
  includeFuture: boolean,
): RetailSalesRow[] {
  return rows.map((row) => ({
    ...row,
    monthly: allYymms.map((yymm) => {
      if (!includeFuture && yymm > CLOSED_THROUGH) return null;
      const idx = queryable.indexOf(yymm);
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

  // 2025년 캐시 확인 (onlyLatest/includeFuture 없는 일반 요청만 캐시)
  if (year === 2025 && !onlyLatest && !includeFuture) {
    const cached = await get2025Cache<PurchaseResponse>('purchase', brand);
    if (cached) return NextResponse.json(cached);
  }

  const { all: allYymms, queryable: allQueryable } = buildYyymmList(year);
  const baseQueryable = includeFuture ? allYymms : allQueryable;
  const queryable = onlyLatest ? baseQueryable.slice(-1) : baseQueryable;

  if (queryable.length === 0) {
    return NextResponse.json({
      year,
      brand,
      closedThrough: CLOSED_THROUGH,
      data: { rows: [] },
    } satisfies PurchaseResponse);
  }

  try {
    const tableData = await fetchPurchaseSales(queryable, brand, year);

    const response: PurchaseResponse = {
      year,
      brand,
      closedThrough: CLOSED_THROUGH,
      data: { rows: padRows(tableData.rows, allYymms, queryable, includeFuture) },
    };

    // 2025년 일반 요청 결과 캐시에 저장
    if (year === 2025 && !onlyLatest && !includeFuture) {
      await set2025Cache('purchase', brand, response);
    }

    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[purchase API] error:', message);
    return NextResponse.json(
      { error: `매입상품 오류: ${message}` },
      { status: 500 },
    );
  }
}
