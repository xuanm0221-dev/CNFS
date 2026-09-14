'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { MONTH_HEADERS, QUARTER_HEADERS } from './pl-forecast/plForecastConfig';
import {
  DEALER_SHIPMENT_BRANDS,
  DealerShipmentBrand,
  DealerShipmentPlanResponse,
  DealerShipmentSeason,
  TagSalesYearResponse,
  buildCurrentYearSeries,
  buildPrevYearSeries,
  empty12,
  emptySeasonMap,
} from '@/lib/dealer-shipment';
import { BASE_YEAR } from '@/lib/base-month';

type Brand = DealerShipmentBrand;
type Season = DealerShipmentSeason;

const BRANDS: Brand[] = DEALER_SHIPMENT_BRANDS;

// 손익계산서 상단 브랜드 탭 id → SalesBrand
const BRAND_ID_TO_NAME: Record<string, Brand> = {
  mlb: 'MLB',
  kids: 'MLB KIDS',
  discovery: 'DISCOVERY',
  duvetica: 'DUVETICA',
  supra: 'SUPRA',
};

interface BrandActualResponse {
  availableMonths?: number[];
}

interface DealerShipmentByBrandProps {
  monthsCollapsed: boolean;
  quarterlyMode: boolean;
  /** 손익계산서 상단 브랜드 탭의 현재 id. null = 전체(법인 합산). */
  selectedBrand?: string | null;
  /**
   * 표시 연도. 기준연도(BASE_YEAR)면 실적+계획, 그 이전 연도면 12개월 전부 실적.
   * 이전 연도는 전년 비교(YoY)를 붙이지 않는다 — 그 전전년 데이터까지는 뽑지 않기로 함.
   */
  year?: number;
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

/**
 * 금액 셀 — 위에 당년 금액, 아래 작은 글씨로 YoY%. 전년이 없거나 계산 불가면 금액만.
 * YoY 행을 따로 두지 않고 셀 안에 넣어 행 수를 절반으로 줄인다.
 */
function AmountCell({ num, denom, showYoy, className }: {
  num: number | null; denom: number | null; showYoy: boolean; className: string;
}) {
  const pct = showYoy ? yoyPct(num, denom) : null;
  const pctText = pct == null ? '' : formatPctRow(pct);
  const pctTone = pct == null ? '' : pct < 100 ? 'text-rose-600' : pct > 100 ? 'text-emerald-600' : 'text-slate-500';
  return (
    <td className={className}>
      <div className="flex flex-col items-end leading-tight">
        <span>{formatKRow(num)}</span>
        {pctText && <span className={`text-[10px] ${pctTone}`}>{pctText}</span>}
      </div>
    </td>
  );
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

export default function DealerShipmentByBrand({ monthsCollapsed, quarterlyMode, selectedBrand = null, year = BASE_YEAR }: DealerShipmentByBrandProps) {
  const isCurrentYear = year === BASE_YEAR;
  const yy = year % 100;
  const [tagCur, setTagCur] = useState<TagSalesYearResponse | null>(null);
  const [tagPrev, setTagPrev] = useState<TagSalesYearResponse | null>(null);
  const [plan, setPlan] = useState<DealerShipmentPlanResponse | null>(null);
  const [brandActual, setBrandActual] = useState<BrandActualResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<boolean>(false); // 기본 펼침

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    // 기준연도: 당년 + 전년 Tag, 계획 CSV, 결산월(brand-actual).
    // 이전 연도: 당년 Tag 만 — 12개월 전부 실적이라 계획·결산월이 필요 없고, 전년 비교는 붙이지 않는다.
    const jsonOrNull = (url: string) => fetch(url, { cache: 'no-store' }).then((r) => r.json());
    Promise.all([
      jsonOrNull(`/api/pl-forecast/tag-sales-2025-preprocess?year=${year}`),
      isCurrentYear ? jsonOrNull(`/api/pl-forecast/tag-sales-2025-preprocess?year=${year - 1}`) : Promise.resolve(null),
      isCurrentYear ? jsonOrNull('/api/pl-forecast/dealer-shipment-plan') : Promise.resolve(null),
      isCurrentYear ? jsonOrNull(`/api/pl-forecast/brand-actual?year=${year}`) : Promise.resolve(null),
    ])
      .then(([tc, tp, p, ba]) => {
        if (!mounted) return;
        setTagCur(tc as TagSalesYearResponse);
        setTagPrev(tp as TagSalesYearResponse | null);
        setPlan(p as DealerShipmentPlanResponse | null);
        setBrandActual(ba as BrandActualResponse | null);
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
  }, [year, isCurrentYear]);

  // 실적/계획 판단 기준: 결산 완료월 (BASE_MONTH 기반 brand-actual API 의 availableMonths)
  // → Snowflake 가 현재 진행월(부분 데이터)도 갖고 있어서 데이터 존재 기준은 부적합.
  //   사용자가 "결산 완료" 선언한 월까지만 실적, 그 이후는 계획.
  const latestActualMonth = useMemo<number>(() => {
    if (!isCurrentYear) return 12; // 지난 연도는 전부 결산 완료
    if (!brandActual?.availableMonths || brandActual.availableMonths.length === 0) return 0;
    return Math.max(...brandActual.availableMonths);
  }, [brandActual, isCurrentYear]);
  /** 전년 데이터가 있을 때만 YoY 행·전년 열을 그린다 */
  const hasPrev = tagPrev != null;

  // 26년 series per brand × season (K 단위) — 손익계산서와 사업계획이 같은 계산을 쓴다
  const seriesCur = useMemo(
    () => buildCurrentYearSeries(tagCur, plan, latestActualMonth, yy),
    [tagCur, plan, latestActualMonth, yy],
  );

  // 25년 series per brand × season (K — Snowflake 전처리는 이미 K 단위)
  const seriesPrev = useMemo(() => buildPrevYearSeries(tagPrev, yy - 1), [tagPrev, yy]);

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
    for (const season of ['당년S', '당년F', '1년차', '차기시즌', '과시즌', 'ACC'] as Season[]) {
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
  const currSeries = selectedBrandName == null ? sumSeriesAcrossBrands(seriesCur) : seriesCur[selectedBrandName];
  const prevSeries = selectedBrandName == null ? sumSeriesAcrossBrands(seriesPrev) : seriesPrev[selectedBrandName];

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
      sumParts([curr.당년F[mi], curr.당년S[mi], curr.ACC[mi], curr['1년차'][mi], curr.차기시즌[mi], curr.과시즌[mi]]),
    );
    const total25 = empty12().map((_, mi) =>
      sumParts([prev.당년F[mi], prev.당년S[mi], prev.ACC[mi], prev['1년차'][mi], prev.차기시즌[mi]]),
    );

    // YoY 는 행이 아니라 각 금액 셀 아래 (YoY%) 로 붙는다
    const rowDefs: Array<{
      label: string;
      isTotal?: boolean;
      num: (number | null)[];
      denom: (number | null)[];
    }> = [
      { label: 'ACC', num: curr.ACC, denom: prev.ACC },
      { label: '당년F', num: curr.당년F, denom: prev.당년F },
      { label: '당년S', num: curr.당년S, denom: prev.당년S },
      { label: '1년차', num: curr['1년차'], denom: prev['1년차'] },
      { label: '차기시즌', num: curr.차기시즌, denom: prev.차기시즌 },
      { label: '과시즌', num: curr.과시즌, denom: prev.과시즌 },
      { label: '합계', num: total26, denom: total25, isTotal: true },
    ];

    return (
      <div key={`dealer-ship-tbl-${keyPrefix}`} className="overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-[200px] border-b border-r border-slate-200 bg-navy px-3 py-2 text-center font-semibold text-white">
                  {titleLabel}
                </th>
                {hasPrev && (
                  <th className="min-w-[130px] border-b border-r border-slate-200 bg-navy px-3 py-2 text-center font-semibold text-white">
                    전년 연간
                  </th>
                )}
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
                  r.label === 'ACC'
                    ? 'bg-highlight-sky'
                    : r.label === '당년F'
                      ? 'bg-white'
                      : r.label === '당년S'
                        ? 'bg-highlight-sky'
                        : r.label === '1년차'
                          ? 'bg-white'
                          : r.label === '차기시즌'
                            ? 'bg-highlight-sky'
                            : r.label === '과시즌'
                              ? 'bg-white'
                              : 'bg-highlight-yellow';
                const rowCls = r.isTotal ? `${groupBg} font-semibold` : groupBg;
                const cell = 'border-b border-r border-slate-200 px-3 py-2 text-right';
                return (
                  <tr key={`dr-${keyPrefix}-${r.label}`} className={rowCls}>
                    <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-inherit px-3 py-2 text-slate-800">
                      {r.label}
                    </td>
                    {hasPrev && (
                      <td className={`${cell} bg-inherit font-medium`}>
                        {formatKRow(sumArr(r.denom))}
                      </td>
                    )}
                    {showQuarterly &&
                      [0, 1, 2, 3].map((qi) => {
                        const start = qi * 3;
                        const end = start + 3;
                        return (
                          <AmountCell
                            key={`dc-${keyPrefix}-${r.label}-q${qi}`}
                            num={sumRange(r.num, start, end)}
                            denom={sumRange(r.denom, start, end)}
                            showYoy={hasPrev}
                            className={cell}
                          />
                        );
                      })}
                    {showMonths &&
                      MONTH_HEADERS.map((_, mi) => (
                        <AmountCell
                          key={`dc-${keyPrefix}-${r.label}-${mi}`}
                          num={r.num[mi]}
                          denom={r.denom[mi]}
                          showYoy={hasPrev}
                          className={cell}
                        />
                      ))}
                    <AmountCell
                      num={sumArr(r.num)}
                      denom={sumArr(r.denom)}
                      showYoy={hasPrev}
                      className="border-b border-slate-200 bg-inherit px-3 py-2 text-right font-medium"
                    />
                  </tr>
                );
              })}
            </tbody>
          </table>
      </div>
    );
  };

  // Tag대비 회수율 표와 같은 꼴 — 카드 하나에 제목 띠(설명·접기 토글) + 표
  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50/60 px-4 py-2">
        <div>
          <div className="font-semibold text-slate-800">대리상 출고표</div>
          <div className="mt-0.5 text-xs text-slate-500">
            {isCurrentYear ? (
              <>
                1~{latestActualMonth}월: Snowflake 실적 · {latestActualMonth + 1}~12월:{' '}
                <code className="rounded bg-slate-100 px-1">{yy}년대리상출고계획.csv</code> (단위: 千 CNY)
              </>
            ) : (
              <>{year}년 1~12월: Snowflake 실적 (단위: 千 CNY) · 전년 비교 없음</>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          {collapsed ? '펼치기' : '접기'}
          {collapsed ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronUp className="h-3.5 w-3.5 text-slate-400" />}
        </button>
      </div>
      {!collapsed && renderTable(currSeries, prevSeries, titleSuffix, selectedBrandName ?? 'all')}
    </div>
  );
}
