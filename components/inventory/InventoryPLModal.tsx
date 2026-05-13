'use client';

import { useEffect, useMemo, useState } from 'react';
import InventoryTable from './InventoryTable';
import { ACC_KEYS, AccKey, InventoryRow, InventoryTableData, SEASON_KEYS, SeasonKey } from '@/lib/inventory-types';
import type { InventoryTopTablePair } from '@/lib/inventory-top-table-pipeline';

type PLBrand = 'MLB' | 'MLB KIDS' | 'DISCOVERY';
type ShipSeason = '당년F' | '당년S' | '1년차' | '차기시즌' | 'ACC';

interface TagSalesBrandData {
  '직영': Record<string, (number | null)[]>;
  '대리상(ACC)': Record<string, (number | null)[]>;
  '대리상(의류)': Record<string, (number | null)[]>;
}
interface TagSalesYearResponse {
  brands?: Record<PLBrand, TagSalesBrandData>;
}
interface DealerShipmentPlanResponse {
  brands?: Record<PLBrand, Record<ShipSeason, (number | null)[]>>;
}
interface BrandActualResponse {
  availableMonths?: number[];
}

interface ShipmentSeries {
  당년F: number[];
  당년S: number[];
  '1년차': number[];
  차기시즌: number[];
  ACC: number[];
}

function empty12(): number[] {
  return new Array(12).fill(0);
}

function sumClothingByYearGte(
  clothing: Record<string, (number | null)[]>,
  minYear: number,
): number[] {
  const out = empty12();
  for (const [tag, series] of Object.entries(clothing)) {
    if (tag === '과시즌') continue;
    const m = tag.match(/^(\d{2})[SF]$/);
    if (!m) continue;
    const yr = Number(m[1]);
    if (!Number.isFinite(yr) || yr < minYear) continue;
    for (let i = 0; i < 12; i += 1) {
      const v = series[i] ?? null;
      if (v != null) out[i] += v;
    }
  }
  return out;
}

function buildShipmentSeries(
  brand: PLBrand,
  tag26: TagSalesYearResponse | null,
  plan: DealerShipmentPlanResponse | null,
  latestActualMonth: number,
): ShipmentSeries {
  // 1~latestActualMonth: Snowflake (이미 K), latestActualMonth+1~12: CSV (CNY → /1000 = K)
  const cloth = tag26?.brands?.[brand]?.['대리상(의류)'] ?? {};
  const sfF = (cloth['26F'] ?? []) as (number | null)[];
  const sfS = (cloth['26S'] ?? []) as (number | null)[];
  const sf25S = (cloth['25S'] ?? []) as (number | null)[];
  const sf25F = (cloth['25F'] ?? []) as (number | null)[];
  const sfNext = sumClothingByYearGte(cloth, 27);
  const sfACC = (Object.values(tag26?.brands?.[brand]?.['대리상(ACC)'] ?? {})[0] ?? []) as (number | null)[];

  const csv = plan?.brands?.[brand];

  const buildFor = (actual: (number | null)[] | number[], csvSeason: ShipSeason): number[] => {
    const csvSeries = csv?.[csvSeason] ?? [];
    const out = empty12();
    for (let i = 0; i < 12; i += 1) {
      if (i < latestActualMonth) {
        out[i] = (actual[i] ?? 0) as number;
      } else {
        const csvCny = csvSeries[i];
        out[i] = csvCny == null ? 0 : csvCny / 1000;
      }
    }
    return out;
  };

  return {
    당년F: buildFor(sfF, '당년F'),
    당년S: buildFor(sfS, '당년S'),
    '1년차': buildFor(
      sf25S.map((v, i) => (v ?? 0) + (sf25F[i] ?? 0)),
      '1년차',
    ),
    차기시즌: buildFor(sfNext, '차기시즌'),
    ACC: buildFor(sfACC, 'ACC'),
  };
}

/**
 * 출고표 시즌 시리즈로 target 컬럼(sellIn or sellOut)을 덮어쓰기. ACC는 합계 행에만 직접 적용.
 * - 대리상 표의 sellIn (= 본사→대리상 입고) ← 출고표
 * - 본사 표의 sellOut (= 본사→대리상 출고) ← 출고표 (동일 흐름의 양면)
 */
function overrideShipmentField(
  table: InventoryTableData,
  ship: ShipmentSeries,
  field: 'sellIn' | 'sellOut',
): InventoryTableData {
  const sumArr = (a: number[]): number => a.reduce((s, v) => s + v, 0);
  const totalField: 'sellInTotal' | 'sellOutTotal' = field === 'sellIn' ? 'sellInTotal' : 'sellOutTotal';
  const seasonMap: Record<string, number[]> = {
    당년F: ship.당년F,
    당년S: ship.당년S,
    '1년차': ship['1년차'],
    차기시즌: ship.차기시즌,
    // 2년차, 과시즌, ACC 개별(신발/모자/가방/기타) → 0
    '2년차': empty12(),
    과시즌: empty12(),
    신발: empty12(),
    모자: empty12(),
    가방: empty12(),
    기타: empty12(),
  };
  const accTotalMonthly = ship.ACC;
  const accTotalAnnual = sumArr(accTotalMonthly);
  const clothingMonthly = [ship.당년F, ship.당년S, ship['1년차'], ship.차기시즌].reduce<number[]>(
    (acc, s) => acc.map((v, i) => v + s[i]),
    empty12(),
  );
  const clothingAnnual = sumArr(clothingMonthly);
  const grandMonthly = clothingMonthly.map((v, i) => v + accTotalMonthly[i]);
  const grandAnnual = clothingAnnual + accTotalAnnual;

  const overrideField = (r: InventoryRow): InventoryRow => {
    if (r.isLeaf) {
      const series = seasonMap[r.key] ?? empty12();
      return { ...r, [field]: [...series], [totalField]: sumArr(series) };
    }
    if (r.key === '의류합계') return { ...r, [field]: [...clothingMonthly], [totalField]: clothingAnnual };
    if (r.key === 'ACC합계') return { ...r, [field]: [...accTotalMonthly], [totalField]: accTotalAnnual };
    if (r.key === '재고자산합계') return { ...r, [field]: [...grandMonthly], [totalField]: grandAnnual };
    return r;
  };

  // inventory-calc.ts의 sellThrough 식 인라인 (export 안되어있음)
  const sellThroughDenom = (key: string, opening: number, sellIn: number): number => {
    if (key === '재고자산합계') return sellIn;
    if (key === '의류합계' || SEASON_KEYS.includes(key as SeasonKey)) return opening + sellIn;
    return sellIn; // ACC합계, 신발/모자/가방/기타
  };
  const sellThroughNum = (key: string, sellOut: number, hqSales?: number): number => {
    const isHqRowWithSales =
      (key === '의류합계' ||
        SEASON_KEYS.includes(key as SeasonKey) ||
        key === 'ACC합계' ||
        key === '재고자산합계' ||
        ACC_KEYS.includes(key as AccKey)) &&
      hqSales != null;
    return isHqRowWithSales ? sellOut + (hqSales ?? 0) : sellOut;
  };
  const YEAR_DAYS_2026 = 365; // 2026은 leap year 아님

  // 기말재고 / Sell-through / WOI 재계산
  //   대리상 기말 = 기초 + Sell-in - Sell-out
  //   본사 기말 = 기초 + 상품매입 - 대리상출고 - 본사판매(hqSales)
  //   신발/모자/가방/기타: ACC합계만 계산 → leaf는 미표시 (0 → '-')
  const recompute = (r: InventoryRow): InventoryRow => {
    if (r.isLeaf && ACC_KEYS.includes(r.key as AccKey)) {
      return { ...r, closing: 0, delta: 0, sellThrough: 0, woi: 0 };
    }
    const opening = r.opening ?? 0;
    const sellIn = r.sellInTotal ?? 0;
    const sellOut = r.sellOutTotal ?? 0;
    const hqSales = r.hqSalesTotal ?? 0;
    const closing = opening + sellIn - sellOut - hqSales;
    const delta = closing - opening;

    const stDenom = sellThroughDenom(r.key, opening, sellIn);
    const stNum = sellThroughNum(r.key, sellOut, r.hqSalesTotal);
    const sellThrough = stDenom > 0 ? (stNum / stDenom) * 100 : 0;

    const woiSellOutTotal = (r.woiSellOut ?? []).reduce((s, v) => s + v, 0);
    const weeklyRate = woiSellOutTotal / (YEAR_DAYS_2026 / 7);
    const woi = weeklyRate > 0 ? closing / weeklyRate : 0;

    return { ...r, closing, delta, sellThrough, woi };
  };

  const newRows: InventoryRow[] = table.rows.map((r) => recompute(overrideField(r)));
  return { rows: newRows };
}

interface Props {
  brand: PLBrand;
  data: InventoryTopTablePair;
  prevData?: InventoryTopTablePair | null;
  year: number;
  onClose: () => void;
}

export default function InventoryPLModal({ brand, data, prevData, year, onClose }: Props) {
  const [tag26, setTag26] = useState<TagSalesYearResponse | null>(null);
  const [plan, setPlan] = useState<DealerShipmentPlanResponse | null>(null);
  const [latestActualMonth, setLatestActualMonth] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    Promise.all([
      fetch('/api/pl-forecast/tag-sales-2025-preprocess?year=2026', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/pl-forecast/dealer-shipment-plan', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/pl-forecast/brand-actual?year=2026', { cache: 'no-store' }).then((r) => r.json()),
    ])
      .then(([t26, p, a]) => {
        if (!mounted) return;
        setTag26(t26 as TagSalesYearResponse);
        setPlan(p as DealerShipmentPlanResponse);
        const ar = a as BrandActualResponse;
        const months = Array.isArray(ar?.availableMonths) ? ar.availableMonths : [];
        setLatestActualMonth(months.length === 0 ? 0 : Math.max(...months));
      })
      .catch((e: unknown) => {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const ship = useMemo(() => {
    if (loading || !tag26 || !plan) return null;
    return buildShipmentSeries(brand, tag26, plan, latestActualMonth);
  }, [brand, tag26, plan, latestActualMonth, loading]);

  const dealerWithOverride = useMemo<InventoryTableData>(() => {
    if (!ship) return data.dealer;
    return overrideShipmentField(data.dealer, ship, 'sellIn');
  }, [data.dealer, ship]);

  const hqWithOverride = useMemo<InventoryTableData>(() => {
    if (!ship) return data.hq;
    return overrideShipmentField(data.hq, ship, 'sellOut');
  }, [data.hq, ship]);

  const buildVsSimMap = (override: InventoryTableData, sim: InventoryTableData): Record<string, number | null> => {
    const simByKey = new Map(sim.rows.map((r) => [r.key, r]));
    const out: Record<string, number | null> = {};
    for (const r of override.rows) {
      // 신발/모자/가방/기타 leaf는 vs 시뮬 계산 안함 (ACC합계 행에서만 표시)
      if (r.isLeaf && ACC_KEYS.includes(r.key as AccKey)) {
        out[r.key] = null;
        continue;
      }
      const s = simByKey.get(r.key);
      out[r.key] = s ? (r.closing ?? 0) - (s.closing ?? 0) : null;
    }
    return out;
  };
  const dealerVsSim = useMemo(() => buildVsSimMap(dealerWithOverride, data.dealer), [dealerWithOverride, data.dealer]);
  const hqVsSim = useMemo(() => buildVsSimMap(hqWithOverride, data.hq), [hqWithOverride, data.hq]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-6"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-[1400px] overflow-auto rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <div>
            <div className="text-lg font-bold text-slate-800">{brand} 재고자산표 — PL용</div>
            <div className="mt-0.5 text-xs text-slate-500">
              재고자산(sim) 표 + 손익계산서 대리상 출고표(Snowflake+CSV)로 본사 대리상출고 / 대리상 Sell-in 동기화
              {loading && ' · 출고 데이터 로딩 중...'}
              {error && ` · 출고 데이터 로드 실패: ${error}`}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            닫기 ✕
          </button>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="min-w-0">
              <InventoryTable
                title={`${brand} 대리상 (CNY K)`}
                data={dealerWithOverride}
                year={year}
                showLegend={false}
                sellInLabel="Sell-in"
                sellOutLabel="Sell-out"
                tableType="dealer"
                vsSimByKey={dealerVsSim}
                prevYearData={prevData?.dealer ?? null}
                prevYearTotalSellIn={prevData?.dealer.rows.find((r) => r.key === '재고자산합계')?.sellInTotal}
                prevYearTotalSellOut={prevData?.dealer.rows.find((r) => r.key === '재고자산합계')?.sellOutTotal}
              />
            </div>
            <div className="min-w-0">
              <InventoryTable
                title={`${brand} 본사 (CNY K)`}
                data={hqWithOverride}
                year={year}
                showLegend={false}
                sellInLabel="상품매입"
                sellOutLabel="대리상출고"
                tableType="hq"
                vsSimByKey={hqVsSim}
                prevYearData={prevData?.hq ?? null}
                prevYearTotalSellIn={prevData?.hq.rows.find((r) => r.key === '재고자산합계')?.sellInTotal}
                prevYearTotalSellOut={prevData?.hq.rows.find((r) => r.key === '재고자산합계')?.sellOutTotal}
                prevYearTotalHqSales={prevData?.hq.rows.find((r) => r.key === '재고자산합계')?.hqSalesTotal}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
