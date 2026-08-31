'use client';

/**
 * 사업계획 — 첫 화면 (브랜드 카드).
 * 브랜드 카드 → 손익계산서 이동. (초기 설계는 CNPL 정적 페이지를 참고했고 현재는 이 컴포넌트가 원본)
 * 카드 지표는 재무제표 대시보드와 같은 PL API 에서 뽑으므로 별도 계산이 없다.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  BP_BRANDS,
  BrandKey,
  PlRow,
  YEAR,
  annualSum,
  fmtK,
  fmtRate,
  plUrl,
} from './shared';
import {
  DEALER_SHIPMENT_SEASONS,
  DealerShipmentBrand,
  DealerShipmentSeason,
  SeasonSeries,
  buildCurrentYearSeries,
  buildPrevYearSeries,
  sumSeries,
} from '@/lib/dealer-shipment';

interface Kpi {
  tag: number | null;
  net: number | null;
  gp: number | null;
  op: number | null;
  /** 리테일매출 + 하위 2개 (대리상/직영) */
  retail: number | null;
  retailDealer: number | null;
  retailDirect: number | null;
  retailPrev: number | null;
  retailDealerPrev: number | null;
  retailDirectPrev: number | null;
  /** Tag매출 하위 4개 (대리상/직영 × 의류/ACC) */
  tagDealerApp: number | null;
  tagDealerAcc: number | null;
  tagDirectApp: number | null;
  tagDirectAcc: number | null;
  /** 전년 연간 — comparisons.prevYearAnnual */
  tagPrev: number | null;
  netPrev: number | null;
  opPrev: number | null;
  tagDealerAppPrev: number | null;
  tagDealerAccPrev: number | null;
  tagDirectAppPrev: number | null;
  tagDirectAccPrev: number | null;
  /** 재무기준 — 손익계산서의 (IFRS) 블록. 상세파일이 없는 브랜드/연도는 null */
  fSales: number | null;
  fGp: number | null;
  fOp: number | null;
  fSalesPrev: number | null;
  fGpPrev: number | null;
  fOpPrev: number | null;
}

/**
 * 재무기준 지표 — 손익계산서 (IFRS) 블록 그대로.
 *   매출     = (IFRS)매출
 *   매출총이익 = (IFRS)매출 − (IFRS)매출원가 − (IFRS)평가감   (관리식 매출총이익과 같은 구조)
 *   영업이익  = (IFRS)영업이익_현지법인기준
 * 상세파일이 없는 연도(2024)나 브랜드는 행 자체가 없어 null 이 된다.
 */
function financialBasis(
  by: Map<string, PlRow>,
  prev: (a: string) => number | null,
): Pick<Kpi, 'fSales' | 'fGp' | 'fOp' | 'fSalesPrev' | 'fGpPrev' | 'fOpPrev'> {
  const sales = annualSum(by.get('(IFRS)매출'));
  const cogs = annualSum(by.get('(IFRS)매출원가'));
  const val = annualSum(by.get('(IFRS)평가감'));
  const gp = sales == null ? null : sales - (cogs ?? 0) - (val ?? 0);

  const salesPrev = prev('(IFRS)매출');
  const cogsPrev = prev('(IFRS)매출원가');
  const valPrev = prev('(IFRS)평가감');
  const gpPrev = salesPrev == null ? null : salesPrev - (cogsPrev ?? 0) - (valPrev ?? 0);

  return {
    fSales: sales,
    fGp: gp,
    fOp: annualSum(by.get('(IFRS)영업이익_현지법인기준')),
    fSalesPrev: salesPrev,
    fGpPrev: gpPrev,
    fOpPrev: prev('(IFRS)영업이익_현지법인기준'),
  };
}

/** 사업계획 브랜드키 → 대리상 출고표 브랜드명 */
const BRAND_KEY_TO_SHIPMENT: Partial<Record<BrandKey, DealerShipmentBrand>> = {
  mlb: 'MLB',
  kids: 'MLB KIDS',
  discovery: 'DISCOVERY',
  duvetica: 'DUVETICA',
  supra: 'SUPRA',
};

/** 비고 컬럼에 쓰는 표기 순서 — 사용자가 지정한 순서 그대로 */
const SHIPMENT_ROWS: { season: DealerShipmentSeason; label: string }[] = [
  { season: 'ACC', label: 'ACC' },
  { season: '당년F', label: '당시즌 F' },
  { season: '당년S', label: '당시즌 S' },
  { season: '1년차', label: '1년차' },
  { season: '차기시즌', label: '차기시즌' },
];

/** 대리상 Tag연간출고 합계 — 5개 시즌 전체 합 */
function sumSeasons(series: SeasonSeries | undefined): number | null {
  if (!series) return null;
  let total = 0;
  let any = false;
  for (const season of DEALER_SHIPMENT_SEASONS) {
    const v = sumSeries(series[season] ?? []);
    if (v != null) { total += v; any = true; }
  }
  return any ? total : null;
}

/** YoY 배수(%) — 당년 ÷ 전년. 소수점 없이 표기 */
function fmtYoy(cur: number | null | undefined, prev: number | null | undefined): string {
  if (cur == null || !prev) return '';
  return ` (${Math.round((cur / prev) * 100)}%)`;
}

/** 증감액 — 부호 포함 K위안 */
function fmtDelta(cur: number | null | undefined, prev: number | null | undefined): string {
  if (cur == null || prev == null) return '–';
  const d = Math.round((cur - prev) / 1000);
  return `${d >= 0 ? '+' : ''}${d.toLocaleString('ko-KR')}`;
}

/** 이익률 증감 (%p) */
function fmtPp(
  cur: number | null | undefined, curBase: number | null | undefined,
  prev: number | null | undefined, prevBase: number | null | undefined,
): string {
  if (cur == null || !curBase || prev == null || !prevBase) return '–';
  const d = (cur / curBase - prev / prevBase) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%p`;
}

/** YoY 색 — 전년비 100% 이상 초록, 미만 빨강 */
function yoyTone(cur: number | null | undefined, prev: number | null | undefined): string {
  if (cur == null || !prev) return 'text-[#6A7686]';
  return cur / prev >= 1 ? 'text-[#176B43]' : 'text-[#A93B33]';
}

const tone = (t: string) => (t.startsWith('+') ? 'text-[#176B43]' : t.startsWith('-') ? 'text-[#A93B33]' : 'text-[#6A7686]');

export default function BusinessPlanHub({ baseMonth }: { baseMonth: number }) {
  const bm = baseMonth; // 재무제표 대시보드 기준월을 그대로 따른다
  const [kpi, setKpi] = useState<Record<string, Kpi>>({});
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  // 브랜드 카드 비고 — 대리상 출고 FCST (손익계산서 대리상 출고표와 같은 계산)
  const [shipCur, setShipCur] = useState<Record<DealerShipmentBrand, SeasonSeries> | null>(null);
  const [shipPrev, setShipPrev] = useState<Record<DealerShipmentBrand, SeasonSeries> | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    const collected: Record<string, Kpi> = {};
    const failures: string[] = [];

    await Promise.all(
      BP_BRANDS.map(async (b) => {
        try {
          const r = await fetch(plUrl(b.key, YEAR, bm), { cache: 'no-store' });
          if (!r.ok) throw new Error(`${b.label} HTTP ${r.status}`);
          const json: { rows?: PlRow[] } = await r.json();
          const by = new Map((json.rows ?? []).map((row) => [row.account, row]));
          const prev = (a: string) => by.get(a)?.comparisons?.prevYearAnnual ?? null;
          collected[b.key] = {
            retail: annualSum(by.get('리테일매출')),
            retailDealer: annualSum(by.get('리테일_대리상')),
            retailDirect: annualSum(by.get('리테일_직영')),
            retailPrev: prev('리테일매출'),
            retailDealerPrev: prev('리테일_대리상'),
            retailDirectPrev: prev('리테일_직영'),
            tag: annualSum(by.get('Tag매출')),
            net: annualSum(by.get('실판매출')),
            gp: annualSum(by.get('매출총이익')),
            op: annualSum(by.get('영업이익(관리식)')),
            tagDealerApp: annualSum(by.get('대리상_의류')),
            tagDealerAcc: annualSum(by.get('대리상_ACC')),
            tagDirectApp: annualSum(by.get('직영_의류')),
            tagDirectAcc: annualSum(by.get('직영_ACC')),
            tagPrev: prev('Tag매출'),
            netPrev: prev('실판매출'),
            opPrev: prev('영업이익(관리식)'),
            tagDealerAppPrev: prev('대리상_의류'),
            tagDealerAccPrev: prev('대리상_ACC'),
            tagDirectAppPrev: prev('직영_의류'),
            tagDirectAccPrev: prev('직영_ACC'),
            ...financialBasis(by, prev),
          };
        } catch (e) {
          failures.push(e instanceof Error ? e.message : String(e));
        }
      }),
    );

    setKpi(collected);
    setErrors(failures);
    setLoading(false);
  }, [bm]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // 대리상 출고 FCST — 실적월은 Snowflake Tag매출, 이후는 출고계획 CSV
  useEffect(() => {
    let mounted = true;
    const yy = YEAR % 100;
    Promise.all([
      fetch(`/api/pl-forecast/tag-sales-2025-preprocess?year=${YEAR}`, { cache: 'no-store' }).then((r) => r.json()),
      fetch(`/api/pl-forecast/tag-sales-2025-preprocess?year=${YEAR - 1}`, { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/pl-forecast/dealer-shipment-plan', { cache: 'no-store' }).then((r) => r.json()),
      fetch(`/api/pl-forecast/brand-actual?year=${YEAR}`, { cache: 'no-store' }).then((r) => r.json()),
    ])
      .then(([tagCur, tagPrev, plan, ba]) => {
        if (!mounted) return;
        const months: number[] = ba?.availableMonths ?? [];
        const latestActualMonth = months.length ? Math.max(...months) : 0;
        setShipCur(buildCurrentYearSeries(tagCur, plan, latestActualMonth, yy));
        setShipPrev(buildPrevYearSeries(tagPrev, yy - 1));
      })
      .catch(() => { /* 비고 영역이라 실패해도 카드 본문은 그대로 */ });
    return () => { mounted = false; };
  }, []);

  return (
    <div className="min-h-screen bg-[#EEF1F4] text-[13px] text-[#1A1A1A]">
      <div className="mx-auto max-w-[1800px] px-6 pb-20 pt-5">
        {/* 헤더 */}
        <div className="border-t-[3px] border-[#15243B] pt-4">
          <div className="text-[11px] tracking-wide text-[#6A7686]">F&amp;F CHINA · 경영관리</div>
          <div className="mt-1 flex flex-wrap items-end gap-3">
            <h1 className="text-[26px] font-bold leading-tight text-[#15243B]">{YEAR} 연간손익</h1>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 border-b border-[#9C7A43] pb-3 text-xs text-[#6A7686]">
            <span>좌측 바에서 브랜드를 선택하세요 · 단위 K위안 · 매출은 실판V−</span>
            <span className="border border-[#C9D2DC] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#34506F]">
              기준월 {bm}월
            </span>
          </div>
        </div>

        {errors.length > 0 && (
          <div className="mb-4 border border-[#A93B33] bg-[#fff5f4] px-4 py-3 text-xs text-[#A93B33]">
            일부 브랜드를 불러오지 못했습니다 — {errors.join(' · ')}
          </div>
        )}

        {/* 카드 */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {BP_BRANDS.map((b) => {
            const k = kpi[b.key];
            const twoCol = b.key === 'all'; // F&F CHINA 만 관리기준 + 재무기준 2열
            const shipBrand = BRAND_KEY_TO_SHIPMENT[b.key]; // 브랜드 카드만 비고(대리상 출고FCST)
            return (
              <div
                key={b.key}
                className={`flex flex-col p-5 ${
                  b.primary
                    ? 'border-2 border-[#15243B] bg-[#f7f9fc]'
                    : 'border border-[#C9D2DC] bg-white'
                }`}
              >
                <div className="text-[20px] font-bold" style={{ color: b.color }}>
                  {b.label}
                </div>

                <div className="mt-3 flex flex-1 gap-4">
                <div className="min-w-0 flex-1">
                  {/* F&F CHINA 카드만 재무기준 컬럼을 함께 보여준다 */}
                  {twoCol && (
                    <div className="flex items-baseline justify-between gap-2 pb-1 text-[10px] font-semibold tracking-wide text-[#6A7686]">
                      <span />
                      <span className="flex shrink-0 gap-2">
                        <span className="w-[132px] text-right">관리기준</span>
                        <span className="w-[132px] border-l border-[#C9D2DC] pl-2 text-right text-[#34506F]">재무기준</span>
                      </span>
                    </div>
                  )}
                  <Kv
                    label="리테일매출"
                    value={loading ? '불러오는 중…' : fmtK(k?.retail)}
                    loading={loading}
                    cur={k?.retail ?? null}
                    prev={k?.retailPrev ?? null}
                    twoCol={twoCol}
                  />
                  {!loading && (
                    <>
                      <SubKv label="ㄴ 대리상" cur={k?.retailDealer} prev={k?.retailDealerPrev} twoCol={twoCol} />
                      <SubKv label="ㄴ 직영" cur={k?.retailDirect} prev={k?.retailDirectPrev} twoCol={twoCol} />
                    </>
                  )}
                  <Kv
                    label="Tag매출"
                    value={loading ? '–' : fmtK(k?.tag)}
                    cur={k?.tag ?? null}
                    prev={k?.tagPrev ?? null}
                    twoCol={twoCol}
                  />
                  {!loading && (
                    <>
                      <SubKv label="ㄴ 대리상 (APP)" cur={k?.tagDealerApp} prev={k?.tagDealerAppPrev} twoCol={twoCol} />
                      <SubKv label="ㄴ 대리상 (ACC)" cur={k?.tagDealerAcc} prev={k?.tagDealerAccPrev} twoCol={twoCol} />
                      <SubKv label="ㄴ 직영 (APP)" cur={k?.tagDirectApp} prev={k?.tagDirectAppPrev} twoCol={twoCol} />
                      <SubKv label="ㄴ 직영 (ACC)" cur={k?.tagDirectAcc} prev={k?.tagDirectAccPrev} twoCol={twoCol} />
                    </>
                  )}
                  <Kv
                    label="실판매출(V−)"
                    value={loading ? '–' : `${fmtK(k?.net)}${fmtYoy(k?.net, k?.netPrev)}`}
                    twoCol={twoCol}
                    value2={loading ? '–' : `${fmtK(k?.fSales)}${fmtYoy(k?.fSales, k?.fSalesPrev)}`}
                  />
                  <Kv
                    label="매출총이익 (률)"
                    value={loading ? '–' : `${fmtK(k?.gp)}${fmtRate(k?.gp, k?.net) === '–' ? '' : ` (${fmtRate(k?.gp, k?.net)})`}`}
                    twoCol={twoCol}
                    value2={loading ? '–' : `${fmtK(k?.fGp)}${fmtRate(k?.fGp, k?.fSales) === '–' ? '' : ` (${fmtRate(k?.fGp, k?.fSales)})`}`}
                  />
                  <Kv
                    label="영업이익 (률)"
                    value={loading ? '–' : `${fmtK(k?.op)}${fmtRate(k?.op, k?.net) === '–' ? '' : ` (${fmtRate(k?.op, k?.net)})`}`}
                    twoCol={twoCol}
                    value2={loading ? '–' : `${fmtK(k?.fOp)}${fmtRate(k?.fOp, k?.fSales) === '–' ? '' : ` (${fmtRate(k?.fOp, k?.fSales)})`}`}
                  />
                  {!loading && (
                    <div className="flex items-baseline justify-between gap-2 pl-3 pt-1.5 text-[11px] text-[#6A7686]">
                      <span className="shrink-0">ㄴ 전년 대비</span>
                      <span className="flex shrink-0 gap-2 tabular-nums">
                        <span className={twoCol ? 'w-[132px] text-right' : 'text-right'}>
                          <span className={tone(fmtDelta(k?.op, k?.opPrev))}>{fmtDelta(k?.op, k?.opPrev)}</span>
                          <span className="mx-1 text-[#C9D2DC]">·</span>
                          <span className={tone(fmtPp(k?.op, k?.net, k?.opPrev, k?.netPrev))}>
                            {fmtPp(k?.op, k?.net, k?.opPrev, k?.netPrev)}
                          </span>
                        </span>
                        {twoCol && (
                          <span className="w-[132px] border-l border-[#E5EAF0] pl-2 text-right">
                            <span className={tone(fmtDelta(k?.fOp, k?.fOpPrev))}>{fmtDelta(k?.fOp, k?.fOpPrev)}</span>
                            <span className="mx-1 text-[#C9D2DC]">·</span>
                            <span className={tone(fmtPp(k?.fOp, k?.fSales, k?.fOpPrev, k?.fSalesPrev))}>
                              {fmtPp(k?.fOp, k?.fSales, k?.fOpPrev, k?.fSalesPrev)}
                            </span>
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                </div>

                {/* 비고 — 대리상 출고 FCST (계정 금액 아님) */}
                {shipBrand && (
                  <div className="w-[190px] shrink-0 border-l border-[#E5EAF0] pl-4">
                    <div className="pb-1 text-[11px] font-semibold text-[#34506F]">대리상 Tag연간출고</div>
                    {SHIPMENT_ROWS.map((r) => {
                      const cur = sumSeries(shipCur?.[shipBrand]?.[r.season] ?? []);
                      const prev = sumSeries(shipPrev?.[shipBrand]?.[r.season] ?? []);
                      return (
                        <div
                          key={r.season}
                          className="flex items-baseline justify-between gap-2 border-b border-dashed border-[#E5EAF0] py-[7px] text-[11px]"
                        >
                          <span className="shrink-0 text-[#6A7686]">{r.label}</span>
                          <span className="whitespace-nowrap text-right tabular-nums text-[#15243B]">
                            {shipCur ? fmtK(cur) : '–'}
                            <span className={yoyTone(cur, prev)}>{fmtYoy(cur, prev)}</span>
                          </span>
                        </div>
                      );
                    })}
                    {(() => {
                      const curTotal = sumSeasons(shipCur?.[shipBrand]);
                      const prevTotal = sumSeasons(shipPrev?.[shipBrand]);
                      return (
                        <div className="flex items-baseline justify-between gap-2 border-b-2 border-[#C9D2DC] py-[7px] text-[11px] font-semibold">
                          <span className="shrink-0 text-[#15243B]">합계</span>
                          <span className="whitespace-nowrap text-right tabular-nums text-[#15243B]">
                            {shipCur ? fmtK(curTotal) : '–'}
                            <span className={yoyTone(curTotal, prevTotal)}>{fmtYoy(curTotal, prevTotal)}</span>
                          </span>
                        </div>
                      );
                    })()}
                    <div className="pt-1.5 text-[10px] leading-4 text-[#9AA6B4]">
                      실적월은 Tag매출(대리상), 이후는 출고계획
                    </div>
                  </div>
                )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 text-[11px] leading-7 text-[#6A7686]">
          · 카드 숫자는 <b>연간 합계</b>(1~12월 합) · Tag·실판 옆 %는 전년 대비 YoY · 이익 옆 %는 실판매출 대비 이익률
          <br />· 기준월({bm}월) 이하는 실적, 이후는 계획
          <br />· 데이터는 재무제표 대시보드와 동일한 PL API 를 사용합니다
          <br />· F&amp;F CHINA 카드의 <b>재무기준</b>은 손익계산서 (IFRS) 블록 값
          <br />· 브랜드 카드 우측 <b>대리상 Tag연간출고</b>는 계정 금액이 아닌 참고값 — 손익계산서 대리상 출고표와 동일
        </div>
      </div>
    </div>
  );
}

/** Tag매출 하위 한 줄 — 들여쓰기, 점선 없음 */
function SubKv({
  label, cur, prev, twoCol,
}: { label: string; cur?: number | null; prev?: number | null; twoCol?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 pl-3 py-[3px] text-[11px] text-[#6A7686]">
      <span className="shrink-0">{label}</span>
      <span className="flex shrink-0 gap-2 tabular-nums">
        <span className={`${twoCol ? 'w-[132px]' : ''} whitespace-nowrap text-right`}>
          {fmtK(cur)}
          <span className={yoyTone(cur, prev)}>{fmtYoy(cur, prev)}</span>
        </span>
        {/* 리테일·Tag 는 재무기준 대응 항목이 없다 */}
        {twoCol && <span className="w-[132px] border-l border-[#E5EAF0] pl-2 text-right text-[#B4BEC9]">–</span>}
      </span>
    </div>
  );
}

/** 카드 안 한 줄 — 라벨 · 점선 · 값 */
function Kv({
  label,
  value,
  loading,
  cur,
  prev,
  twoCol,
  value2,
}: {
  label: string;
  value: string;
  loading?: boolean;
  /** 주면 값 뒤에 YoY 를 색과 함께 붙인다 (100% 이상 초록 / 미만 빨강) */
  cur?: number | null;
  prev?: number | null;
  /** F&F CHINA 카드 — 재무기준 컬럼을 함께 그린다 */
  twoCol?: boolean;
  /** 재무기준 값. 없으면 '–' (대응 항목 없음) */
  value2?: string;
}) {
  const showYoy = cur !== undefined;
  const valueTone = loading ? 'text-[#9C7A43]' : 'text-[#15243B]';
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-dashed border-[#E5EAF0] py-[7px]">
      {/* 라벨 색을 우측 값과 맞춘다 */}
      <span className={`shrink-0 text-xs font-medium ${loading ? 'text-[#9C7A43]' : 'text-[#15243B]'}`}>
        {label}
      </span>
      <span className="flex shrink-0 gap-2 text-[13px] font-semibold tabular-nums">
        <span className={`${twoCol ? 'w-[132px]' : ''} whitespace-nowrap text-right ${valueTone}`}>
          {value}
          {showYoy && !loading && <span className={yoyTone(cur, prev)}>{fmtYoy(cur, prev)}</span>}
        </span>
        {twoCol && (
          <span
            className={`w-[132px] whitespace-nowrap border-l border-[#E5EAF0] pl-2 text-right ${
              value2 ? 'text-[#34506F]' : 'text-[#B4BEC9]'
            }`}
          >
            {value2 ?? '–'}
          </span>
        )}
      </span>
    </div>
  );
}
