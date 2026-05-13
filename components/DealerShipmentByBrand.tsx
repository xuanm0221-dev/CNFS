'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { MONTH_HEADERS, QUARTER_HEADERS } from './pl-forecast/plForecastConfig';

type Brand = 'MLB' | 'MLB KIDS' | 'DISCOVERY' | 'DUVETICA' | 'SUPRA';
type Season = '당년S' | '당년F' | '1년차' | '차기시즌' | 'ACC';

const BRANDS: Brand[] = ['MLB', 'MLB KIDS', 'DISCOVERY', 'DUVETICA', 'SUPRA'];

// 손익계산서 상단 브랜드 탭 id → SalesBrand
const BRAND_ID_TO_NAME: Record<string, Brand> = {
  mlb: 'MLB',
  kids: 'MLB KIDS',
  discovery: 'DISCOVERY',
  duvetica: 'DUVETICA',
  supra: 'SUPRA',
};

interface TagSalesBrandData {
  '직영': Record<string, (number | null)[]>;
  '대리상(ACC)': Record<string, (number | null)[]>;
  '대리상(의류)': Record<string, (number | null)[]>;
}

interface TagSalesYearResponse {
  year?: number;
  brands?: Record<Brand, TagSalesBrandData>;
}

interface DealerShipmentPlanResponse {
  brands?: Record<Brand, Record<Season, (number | null)[]>>;
}

interface BrandActualResponse {
  availableMonths?: number[];
}

interface DealerShipmentByBrandProps {
  monthsCollapsed: boolean;
  quarterlyMode: boolean;
  /** 손익계산서 상단 브랜드 탭의 현재 id. null = 전체(법인 합산). */
  selectedBrand?: string | null;
}

function empty12(): (number | null)[] {
  return new Array(12).fill(null);
}

function emptySeasonMap(): Record<Season, (number | null)[]> {
  return { 당년S: empty12(), 당년F: empty12(), '1년차': empty12(), 차기시즌: empty12(), ACC: empty12() };
}

function sumClothingByYearGte(
  clothing: Record<string, (number | null)[]>,
  minYear: number,
): (number | null)[] {
  const out: (number | null)[] = empty12();
  for (const [tag, series] of Object.entries(clothing)) {
    if (tag === '과시즌') continue;
    const m = tag.match(/^(\d{2})[SF]$/);
    if (!m) continue;
    const yr = Number(m[1]);
    if (!Number.isFinite(yr) || yr < minYear) continue;
    for (let i = 0; i < 12; i += 1) {
      const v = series[i] ?? null;
      if (v != null) out[i] = (out[i] ?? 0) + v;
    }
  }
  return out;
}

function pairSum(a: (number | null)[], b: (number | null)[]): (number | null)[] {
  const out: (number | null)[] = empty12();
  for (let i = 0; i < 12; i += 1) {
    const va = a[i] ?? null;
    const vb = b[i] ?? null;
    if (va == null && vb == null) out[i] = null;
    else out[i] = (va ?? 0) + (vb ?? 0);
  }
  return out;
}

function formatKRow(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '';
  if (Math.round(v) === 0) return '';
  return Math.round(v).toLocaleString();
}

function formatPctRow(v: number | null): string {
  if (v == null) return '';
  if (Math.round(v) === 0) return '';
  return `${Math.round(v)}%`;
}

function yoyPct(num: number | null, denom: number | null): number | null {
  if (num == null || denom == null || denom === 0) return null;
  return (num / denom) * 100;
}

function sumArr(arr: (number | null)[]): number | null {
  let s = 0;
  let any = false;
  for (const v of arr) if (v != null) {
    s += v;
    any = true;
  }
  return any ? s : null;
}

function sumRange(arr: (number | null)[], start: number, end: number): number | null {
  let s = 0;
  let any = false;
  for (let i = start; i < end; i += 1) {
    const v = arr[i];
    if (v != null && Number.isFinite(v)) {
      s += v;
      any = true;
    }
  }
  return any ? s : null;
}

export default function DealerShipmentByBrand({ monthsCollapsed, quarterlyMode, selectedBrand = null }: DealerShipmentByBrandProps) {
  const [tag26, setTag26] = useState<TagSalesYearResponse | null>(null);
  const [tag25, setTag25] = useState<TagSalesYearResponse | null>(null);
  const [plan, setPlan] = useState<DealerShipmentPlanResponse | null>(null);
  const [availableMonths, setAvailableMonths] = useState<number[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<boolean>(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    Promise.all([
      fetch('/api/pl-forecast/tag-sales-2025-preprocess?year=2026', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/pl-forecast/tag-sales-2025-preprocess?year=2025', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/pl-forecast/dealer-shipment-plan', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/pl-forecast/brand-actual?year=2026', { cache: 'no-store' }).then((r) => r.json()),
    ])
      .then(([t26, t25, p, a]) => {
        if (!mounted) return;
        setTag26(t26 as TagSalesYearResponse);
        setTag25(t25 as TagSalesYearResponse);
        setPlan(p as DealerShipmentPlanResponse);
        const ar = a as BrandActualResponse;
        setAvailableMonths(Array.isArray(ar?.availableMonths) ? ar.availableMonths : []);
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

  const latestActualMonth = availableMonths.length === 0 ? 0 : Math.max(...availableMonths);

  // 26년 series per brand × season (K 단위)
  //   1~latestActualMonth: Snowflake Tag매출 전처리 (이미 K)
  //   latestActualMonth+1 ~ 12월: 26년대리상출고계획.csv (API에서 CNY로 변환되어 옴 → /1000 = K)
  const series26 = useMemo(() => {
    const out = {} as Record<Brand, Record<Season, (number | null)[]>>;
    for (const b of BRANDS) {
      const cloth = tag26?.brands?.[b]?.['대리상(의류)'] ?? {};
      const sf당년S = cloth['26S'] ?? empty12();
      const sf당년F = cloth['26F'] ?? empty12();
      const sf25S = cloth['25S'] ?? empty12();
      const sf25F = cloth['25F'] ?? empty12();
      const sf차기 = sumClothingByYearGte(cloth, 27);
      const sfACC = Object.values(tag26?.brands?.[b]?.['대리상(ACC)'] ?? {})[0] ?? empty12();
      const sf1년차 = pairSum(sf25S, sf25F);

      const csvBrand = plan?.brands?.[b];
      const actualBySeason: Record<Season, (number | null)[]> = {
        당년S: sf당년S,
        당년F: sf당년F,
        '1년차': sf1년차,
        차기시즌: sf차기,
        ACC: sfACC,
      };
      const result: Record<Season, (number | null)[]> = emptySeasonMap();
      for (const season of ['당년S', '당년F', '1년차', '차기시즌', 'ACC'] as Season[]) {
        const csvSeries = csvBrand?.[season] ?? empty12();
        const actualSeries = actualBySeason[season];
        for (let i = 0; i < 12; i += 1) {
          if (i < latestActualMonth) {
            result[season][i] = actualSeries[i] ?? null;
          } else {
            const csvCny = csvSeries[i];
            result[season][i] = csvCny == null ? null : csvCny / 1000; // CNY → K
          }
        }
      }
      out[b] = result;
    }
    return out;
  }, [tag26, plan, latestActualMonth]);

  // 25년 series per brand × season (K — Snowflake 전처리는 이미 K 단위)
  const series25 = useMemo(() => {
    const out = {} as Record<Brand, Record<Season, (number | null)[]>>;
    for (const b of BRANDS) {
      const cloth = tag25?.brands?.[b]?.['대리상(의류)'] ?? {};
      const sf당년S = cloth['25S'] ?? empty12();
      const sf당년F = cloth['25F'] ?? empty12();
      const sf24S = cloth['24S'] ?? empty12();
      const sf24F = cloth['24F'] ?? empty12();
      const sf차기 = sumClothingByYearGte(cloth, 26);
      const sfACC = Object.values(tag25?.brands?.[b]?.['대리상(ACC)'] ?? {})[0] ?? empty12();
      out[b] = {
        당년S: [...sf당년S],
        당년F: [...sf당년F],
        '1년차': pairSum(sf24S, sf24F),
        차기시즌: sf차기,
        ACC: [...sfACC],
      };
    }
    return out;
  }, [tag25]);

  if (loading) {
    return (
      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
        대리상 출고표 로딩 중...
      </div>
    );
  }
  if (error) {
    return (
      <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        대리상 출고표 로딩 실패: {error}
      </div>
    );
  }

  const showQuarterly = quarterlyMode;
  const showMonths = !monthsCollapsed && !quarterlyMode;

  // 브랜드 선택에 따라 5브랜드 합산 or 단일 브랜드 시리즈 결정
  const sumSeriesAcrossBrands = (
    src: Record<Brand, Record<Season, (number | null)[]>>,
  ): Record<Season, (number | null)[]> => {
    const result: Record<Season, (number | null)[]> = emptySeasonMap();
    for (const season of ['당년S', '당년F', '1년차', '차기시즌', 'ACC'] as Season[]) {
      for (let i = 0; i < 12; i += 1) {
        let s = 0;
        let any = false;
        for (const b of BRANDS) {
          const v = src[b]?.[season]?.[i] ?? null;
          if (v != null) {
            s += v;
            any = true;
          }
        }
        result[season][i] = any ? s : null;
      }
    }
    return result;
  };

  const selectedBrandName: Brand | null =
    selectedBrand != null && BRAND_ID_TO_NAME[selectedBrand] != null
      ? BRAND_ID_TO_NAME[selectedBrand]
      : null;
  const titleSuffix = selectedBrandName == null ? '법인 (5브랜드 합산)' : selectedBrandName;
  const currSeries = selectedBrandName == null ? sumSeriesAcrossBrands(series26) : series26[selectedBrandName];
  const prevSeries = selectedBrandName == null ? sumSeriesAcrossBrands(series25) : series25[selectedBrandName];

  const renderTable = (
    curr: Record<Season, (number | null)[]>,
    prev: Record<Season, (number | null)[]>,
    titleLabel: string,
    keyPrefix: string,
  ) => {

    const sumParts = (parts: (number | null)[]): number | null => {
      const defined = parts.filter((v): v is number => v != null);
      return defined.length ? defined.reduce((s, v) => s + v, 0) : null;
    };
    const total26 = empty12().map((_, mi) =>
      sumParts([curr.당년F[mi], curr.당년S[mi], curr.ACC[mi], curr['1년차'][mi], curr.차기시즌[mi]]),
    );
    const total25 = empty12().map((_, mi) =>
      sumParts([prev.당년F[mi], prev.당년S[mi], prev.ACC[mi], prev['1년차'][mi], prev.차기시즌[mi]]),
    );

    const rowDefs: Array<{
      label: string;
      isYoy?: boolean;
      isTotal?: boolean;
      num: (number | null)[];
      denom: (number | null)[];
    }> = [
      { label: 'ACC', num: curr.ACC, denom: prev.ACC },
      { label: 'YoY (ACC)', num: curr.ACC, denom: prev.ACC, isYoy: true },
      { label: '당년F', num: curr.당년F, denom: prev.당년F },
      { label: 'YoY (F)', num: curr.당년F, denom: prev.당년F, isYoy: true },
      { label: '당년S', num: curr.당년S, denom: prev.당년S },
      { label: 'YoY (S)', num: curr.당년S, denom: prev.당년S, isYoy: true },
      { label: '1년차', num: curr['1년차'], denom: prev['1년차'] },
      { label: 'YoY (1년차)', num: curr['1년차'], denom: prev['1년차'], isYoy: true },
      { label: '차기시즌', num: curr.차기시즌, denom: prev.차기시즌 },
      { label: 'YoY (차기시즌)', num: curr.차기시즌, denom: prev.차기시즌, isYoy: true },
      { label: '합계', num: total26, denom: total25, isTotal: true },
      { label: 'YoY (합계)', num: total26, denom: total25, isYoy: true, isTotal: true },
    ];

    return (
      <div
        key={`dealer-ship-tbl-${keyPrefix}`}
        className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-sm"
      >
        <div className="overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-[260px] border-b border-r border-slate-200 bg-navy px-3 py-2 text-center font-semibold text-white">
                  대리상 출고표 — {titleLabel}
                </th>
                <th className="min-w-[130px] border-b border-r border-slate-200 bg-navy px-3 py-2 text-center font-semibold text-white">
                  전년 연간
                </th>
                {showQuarterly &&
                  QUARTER_HEADERS.map((label, idx) => {
                    const isForecast = (idx + 1) * 3 > latestActualMonth;
                    return (
                      <th
                        key={`dh-${keyPrefix}-${label}`}
                        className="min-w-[130px] border-b border-r border-slate-200 bg-navy px-3 py-2 text-center font-semibold text-white"
                      >
                        {label}
                        {isForecast ? ' (F)' : ''}
                      </th>
                    );
                  })}
                {showMonths &&
                  MONTH_HEADERS.map((label, idx) => {
                    const isForecast = idx >= latestActualMonth;
                    return (
                      <th
                        key={`dh-${keyPrefix}-${label}`}
                        className="min-w-[105px] border-b border-r border-slate-200 bg-navy px-3 py-2 text-center font-semibold text-white"
                      >
                        {label}
                        {isForecast ? ' (F)' : ''}
                      </th>
                    );
                  })}
                <th className="min-w-[130px] border-b border-slate-200 bg-navy px-3 py-2 text-center font-semibold text-white">
                  연간
                </th>
              </tr>
            </thead>
            <tbody>
              {rowDefs.map((r) => {
                const groupBg =
                  r.label === 'ACC' || r.label === 'YoY (ACC)'
                    ? 'bg-highlight-sky'
                    : r.label === '당년F' || r.label === 'YoY (F)'
                      ? 'bg-white'
                      : r.label === '당년S' || r.label === 'YoY (S)'
                        ? 'bg-highlight-sky'
                        : r.label === '1년차' || r.label === 'YoY (1년차)'
                          ? 'bg-white'
                          : r.label === '차기시즌' || r.label === 'YoY (차기시즌)'
                            ? 'bg-highlight-sky'
                            : 'bg-highlight-yellow';
                const rowCls = r.isYoy
                  ? `${groupBg} italic`
                  : r.isTotal
                    ? `${groupBg} font-semibold [&>td]:!border-b-0`
                    : `${groupBg} [&>td]:!border-b-0`;
                return (
                  <tr key={`dr-${keyPrefix}-${r.label}`} className={rowCls}>
                    <td
                      className="sticky left-0 z-10 border-b border-r border-slate-200 bg-inherit px-3 py-2 text-slate-800"
                      style={r.isYoy ? { paddingLeft: 28 } : undefined}
                    >
                      {r.label}
                    </td>
                    <td className="border-b border-r border-slate-200 bg-inherit px-3 py-2 text-right font-medium">
                      {r.isYoy ? '' : formatKRow(sumArr(r.denom))}
                    </td>
                    {showQuarterly &&
                      [0, 1, 2, 3].map((qi) => {
                        const start = qi * 3;
                        const end = start + 3;
                        return (
                          <td
                            key={`dc-${keyPrefix}-${r.label}-q${qi}`}
                            className="border-b border-r border-slate-200 px-3 py-2 text-right"
                          >
                            {r.isYoy
                              ? formatPctRow(yoyPct(sumRange(r.num, start, end), sumRange(r.denom, start, end)))
                              : formatKRow(sumRange(r.num, start, end))}
                          </td>
                        );
                      })}
                    {showMonths &&
                      MONTH_HEADERS.map((_, mi) => (
                        <td
                          key={`dc-${keyPrefix}-${r.label}-${mi}`}
                          className="border-b border-r border-slate-200 px-3 py-2 text-right"
                        >
                          {r.isYoy ? formatPctRow(yoyPct(r.num[mi], r.denom[mi])) : formatKRow(r.num[mi])}
                        </td>
                      ))}
                    <td className="border-b border-slate-200 bg-inherit px-3 py-2 text-right font-medium">
                      {r.isYoy
                        ? formatPctRow(yoyPct(sumArr(r.num), sumArr(r.denom)))
                        : formatKRow(sumArr(r.num))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="mt-8">
      <button
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white/85 px-4 py-3 text-left shadow-sm transition-colors hover:bg-slate-50"
      >
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[#3b5f93] text-xs font-semibold text-white">
          출
        </span>
        <span className="flex-1">
          <span className="block font-semibold text-slate-800">대리상 출고표</span>
          <span className="mt-0.5 block text-xs text-slate-500">
            1~{latestActualMonth}월: Snowflake 실적 · {latestActualMonth + 1}~12월:{' '}
            <code className="rounded bg-slate-100 px-1">26년대리상출고계획.csv</code> (단위: 千 CNY)
          </span>
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
          {collapsed ? '펼치기' : '접기'}
          {collapsed ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronUp className="h-3.5 w-3.5 text-slate-400" />}
        </span>
      </button>
      {!collapsed && renderTable(currSeries, prevSeries, titleSuffix, selectedBrandName ?? 'all')}
    </div>
  );
}
