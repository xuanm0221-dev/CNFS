import { NextRequest, NextResponse } from 'next/server';
import { CLOSED_THROUGH } from '@/lib/inventory-db';
import { fetchRetailSales } from '@/lib/retail-sales-db';
import { RetailSalesResponse, RetailSalesRow } from '@/lib/retail-sales-types';
import { mergePlanMonths } from '@/lib/retail-plan';
import { get2025Cache, set2025Cache } from '@/lib/inventory-2025-cache';

/** YYMM 문자열 생성 (예: year=2025, month=1 → '202501') */
function toYYMM(year: number, month: number): string {
  return `${year}${String(month).padStart(2, '0')}`;
}

/**
 * year 기준 YYMM 리스트 생성 — 기초 없음, 1월~12월만
 * all[0..11]    = 해당 연도 1월~12월
 * queryable     = all 중 CLOSED_THROUGH 이하인 것만
 */
function buildYyymmList(year: number) {
  const all: string[] = Array.from({ length: 12 }, (_, i) => toYYMM(year, i + 1));
  const queryable = all.filter((yymm) => yymm <= CLOSED_THROUGH);
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
): RetailSalesRow[] {
  return rows.map((row) => ({
    ...row,
    monthly: allYymms.map((yymm) => {
      if (yymm > CLOSED_THROUGH) return null;
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

  // 2025년 캐시 확인
  if (year === 2025) {
    const cached = await get2025Cache<RetailSalesResponse>('retail-sales', brand);
    if (cached) return NextResponse.json(cached);
  }

  const { all: allYymms, queryable } = buildYyymmList(year);

  if (queryable.length === 0 && year !== 2026) {
    return NextResponse.json({
      year,
      brand,
      closedThrough: CLOSED_THROUGH,
      dealer: { rows: [] },
      hq: { rows: [] },
    } satisfies RetailSalesResponse);
  }

  try {
    if (year === 2026) {
      const { all: all2026, queryable: queryable2026 } = buildYyymmList(2026);
      const { all: all2025, queryable: queryable2025 } = buildYyymmList(2025);
      const planFromMonth = getPlanFromMonth(queryable2026);
      const [data2026, data2025] = await Promise.all([
        queryable2026.length > 0
          ? fetchRetailSales(queryable2026, brand, 2026).then((r) => ({
              dealer: { rows: padRows(r.dealer.rows, all2026, queryable2026) },
              hq: { rows: padRows(r.hq.rows, all2026, queryable2026) },
            }))
          : {
              dealer: { rows: [] as RetailSalesRow[] },
              hq: { rows: [] as RetailSalesRow[] },
            },
        fetchRetailSales(queryable2025, brand, 2025).then((r) => ({
          dealer: { rows: padRows(r.dealer.rows, all2025, queryable2025) },
          hq: { rows: padRows(r.hq.rows, all2025, queryable2025) },
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
          closedThrough: CLOSED_THROUGH,
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
          closedThrough: CLOSED_THROUGH,
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
      closedThrough: CLOSED_THROUGH,
      dealer: { rows: padRows(dealer.rows, allYymms, queryable) },
      hq:     { rows: padRows(hq.rows,     allYymms, queryable) },
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
