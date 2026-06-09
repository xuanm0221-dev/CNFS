import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { CLOSED_THROUGH } from '@/lib/inventory-db';
import { fetchPurchaseSales } from '@/lib/purchase-db';
import { RetailSalesTableData, RetailSalesRow } from '@/lib/retail-sales-types';
import { get2025Cache, set2025Cache } from '@/lib/inventory-2025-cache';

export const dynamic = 'force-dynamic';

/**
 * Precomputed JSON 의 closedThrough 읽기 — 사용자 마지막 전처리 월.
 * 라이브 API 도 동일 closedThrough 사용 → 백그라운드 fetch 가 옛 데이터로 덮어쓰는 race 방지.
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
      `purchase-${safeBrand}.json`,
    );
    if (!fs.existsSync(filePath)) return null;
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { closedThrough?: string };
    return content.closedThrough ?? null;
  } catch {
    return null;
  }
}

export interface PurchaseResponse {
  year: number;
  brand: string;
  closedThrough: string;
  data: RetailSalesTableData;
}

function toYYMM(year: number, month: number): string {
  return `${year}${String(month).padStart(2, '0')}`;
}

function buildYyymmList(year: number, effectiveClosed: string) {
  const all: string[] = Array.from({ length: 12 }, (_, i) => toYYMM(year, i + 1));
  const queryable = all.filter((yymm) => yymm <= effectiveClosed);
  return { all, queryable };
}

function padRows(
  rows: RetailSalesRow[],
  allYymms: string[],
  queryable: string[],
  includeFuture: boolean,
  effectiveClosed: string,
): RetailSalesRow[] {
  return rows.map((row) => ({
    ...row,
    monthly: allYymms.map((yymm) => {
      if (!includeFuture && yymm > effectiveClosed) return null;
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
  // effectiveClosed 우선순위: 1) 클라이언트 명시, 2) precomputed JSON, 3) CLOSED_THROUGH 상수
  const clientClosed = searchParams.get('closedThrough');
  const precomputedClosed = year === 2026 ? readPrecomputedClosedThrough(year, brand) : null;
  const effectiveClosed = clientClosed || precomputedClosed || CLOSED_THROUGH;

  // 2025년 캐시 확인 (onlyLatest/includeFuture 없는 일반 요청만 캐시)
  if (year === 2025 && !onlyLatest && !includeFuture) {
    const cached = await get2025Cache<PurchaseResponse>('purchase', brand);
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
      data: { rows: [] },
    } satisfies PurchaseResponse);
  }

  try {
    const tableData = await fetchPurchaseSales(queryable, brand, year);

    const response: PurchaseResponse = {
      year,
      brand,
      closedThrough: effectiveClosed,
      data: { rows: padRows(tableData.rows, allYymms, queryable, includeFuture, effectiveClosed) },
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
