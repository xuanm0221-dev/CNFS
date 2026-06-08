import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { CLOSED_THROUGH } from '@/lib/inventory-db';
import { fetchRetailSales } from '@/lib/retail-sales-db';
import { RetailSalesResponse, RetailSalesRow } from '@/lib/retail-sales-types';
import { mergePlanMonths } from '@/lib/retail-plan';
import { get2025Cache, set2025Cache } from '@/lib/inventory-2025-cache';

/**
 * Precomputed JSON 의 closedThrough 읽기.
 * "사용자가 마지막으로 전처리한 월" — refresh_2026_retail_sales.py --baseMonth N 결과.
 * Snowflake 의 부분 월 데이터 (예: 오늘이 6/8 이면 6월에 8일치 매출) 에 휘둘리지 않게
 * 라이브 API 도 precomputed JSON 의 closedThrough 를 따라가도록 함.
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
      `retail-sales-${safeBrand}.json`,
    );
    if (!fs.existsSync(filePath)) return null;
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { closedThrough?: string };
    return content.closedThrough ?? null;
  } catch {
    return null;
  }
}

export const dynamic = 'force-dynamic';

/** YYMM 문자열 생성 (예: year=2025, month=1 → '202501') */
function toYYMM(year: number, month: number): string {
  return `${year}${String(month).padStart(2, '0')}`;
}

/**
 * year 기준 YYMM 리스트 생성 — 기초 없음, 1월~12월만
 * all[0..11]    = 해당 연도 1월~12월
 * queryable     = all 중 effectiveClosed 이하인 것만
 */
function buildYyymmList(year: number, effectiveClosed: string) {
  const all: string[] = Array.from({ length: 12 }, (_, i) => toYYMM(year, i + 1));
  const queryable = all.filter((yymm) => yymm <= effectiveClosed);
  return { all, queryable };
}

function getPlanFromMonth(queryableMonths: string[]): number {
  return queryableMonths.length + 1;
}

/**
 * DB 조회 결과의 monthly 배열(queryable 기준 인덱스)을
 * 연도 전체 12개월 기준으로 재정렬.
 * 미마감 월 → null, 마감 월 → DB 값 (없으면 null)
 */
function padRows(
  rows: RetailSalesRow[],
  allYymms: string[],      // 1월~12월 12개
  queryable: string[],     // 마감된 월만
  effectiveClosed: string,
): RetailSalesRow[] {
  return rows.map((row) => ({
    ...row,
    monthly: allYymms.map((yymm) => {
      if (yymm > effectiveClosed) return null;
      const idx = queryable.indexOf(yymm);
      return idx >= 0 ? (row.monthly[idx] ?? null) : null;
    }),
  }));
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const year = parseInt(searchParams.get('year') ?? '2025', 10);
  const brand = searchParams.get('brand') ?? 'MLB';
  const growthRate = parseFloat(searchParams.get('growthRate') ?? '5');
  const growthRateHq = parseFloat(searchParams.get('growthRateHq') ?? '10');
  const factorDealer = 1 + growthRate / 100;
  const factorHq = 1 + growthRateHq / 100;
  // effectiveClosed 우선순위:
  //   1) 클라이언트가 명시한 closedThrough (스크립트/외부 호출)
  //   2) precomputed JSON 의 closedThrough (= 사용자가 마지막 refresh 스크립트 실행 시 baseMonth)
  //   3) CLOSED_THROUGH 상수 (fallback, 이전 month 기준)
  // → 라이브 API 도 precomputed JSON 과 동일 closedThrough 사용 → planFromMonth 일관성 유지
  //   Snowflake 의 부분 월 데이터(오늘 날짜까지의 실시간 매출) 가 (F) 판단에 영향 안 줌
  const clientClosed = searchParams.get('closedThrough');
  const precomputedClosed = year === 2026 ? readPrecomputedClosedThrough(year, brand) : null;
  const effectiveClosed = clientClosed || precomputedClosed || CLOSED_THROUGH;

  // 2025년 캐시 확인
  if (year === 2025) {
    const cached = await get2025Cache<RetailSalesResponse>('retail-sales', brand);
    if (cached) return NextResponse.json(cached);
  }

  const { all: allYymms, queryable } = buildYyymmList(year, effectiveClosed);

  if (queryable.length === 0 && year !== 2026) {
    return NextResponse.json({
      year,
      brand,
      closedThrough: effectiveClosed,
      dealer: { rows: [] },
      hq: { rows: [] },
    } satisfies RetailSalesResponse);
  }

  try {
    if (year === 2026) {
      const { all: all2026, queryable: queryable2026 } = buildYyymmList(2026, effectiveClosed);
      const { all: all2025, queryable: queryable2025 } = buildYyymmList(2025, CLOSED_THROUGH);
      const planFromMonth = getPlanFromMonth(queryable2026);
      const [data2026, data2025] = await Promise.all([
        queryable2026.length > 0
          ? fetchRetailSales(queryable2026, brand, 2026).then((r) => ({
              dealer: { rows: padRows(r.dealer.rows, all2026, queryable2026, effectiveClosed) },
              hq: { rows: padRows(r.hq.rows, all2026, queryable2026, effectiveClosed) },
            }))
          : {
              dealer: { rows: [] as RetailSalesRow[] },
              hq: { rows: [] as RetailSalesRow[] },
            },
        fetchRetailSales(queryable2025, brand, 2025).then((r) => ({
          dealer: { rows: padRows(r.dealer.rows, all2025, queryable2025, CLOSED_THROUGH) },
          hq: { rows: padRows(r.hq.rows, all2025, queryable2025, CLOSED_THROUGH) },
        })),
      ]);
      if (data2026.dealer.rows.length === 0 && data2025.dealer.rows.length > 0) {
        const emptyCurrDealer = data2025.dealer.rows.map((r) => ({
          ...r,
          monthly: r.monthly.map(() => null) as (number | null)[],
        }));
        const emptyCurrHq = data2025.hq.rows.map((r) => ({
          ...r,
          monthly: r.monthly.map(() => null) as (number | null)[],
        }));
        const response: RetailSalesResponse = {
          year: 2026,
          brand,
          closedThrough: effectiveClosed,
          dealer: { rows: mergePlanMonths(emptyCurrDealer, data2025.dealer.rows, planFromMonth, factorDealer) },
          hq: { rows: mergePlanMonths(emptyCurrHq, data2025.hq.rows, planFromMonth, factorHq) },
          planFromMonth,
          retail2025: { dealer: data2025.dealer, hq: data2025.hq },
        };
        return NextResponse.json(response);
      }
      if (data2026.dealer.rows.length > 0 && data2025.dealer.rows.length > 0) {
        const response: RetailSalesResponse = {
          year: 2026,
          brand,
          closedThrough: effectiveClosed,
          dealer: { rows: mergePlanMonths(data2026.dealer.rows, data2025.dealer.rows, planFromMonth, factorDealer) },
          hq: { rows: mergePlanMonths(data2026.hq.rows, data2025.hq.rows, planFromMonth, factorHq) },
          planFromMonth,
          retail2025: { dealer: data2025.dealer, hq: data2025.hq },
        };
        return NextResponse.json(response);
      }
    }

    const { dealer, hq } = await fetchRetailSales(queryable, brand, year);

    const response: RetailSalesResponse = {
      year,
      brand,
      closedThrough: effectiveClosed,
      dealer: { rows: padRows(dealer.rows, allYymms, queryable, effectiveClosed) },
      hq:     { rows: padRows(hq.rows,     allYymms, queryable, effectiveClosed) },
    };

    // 2025년 결과 캐시에 저장
    if (year === 2025) {
      await set2025Cache('retail-sales', brand, response);
    }

    return NextResponse.json(response);
  } catch (err) {
    console.error('[retail-sales API] error:', err);
    return NextResponse.json(
      { error: '리테일 매출 데이터를 불러오는데 실패했습니다.' },
      { status: 500 },
    );
  }
}
