'use client';

import { useEffect, useState } from 'react';

type Brand = 'MLB' | 'MLB KIDS';

interface BrandData {
  months: string[];
  rows: {
    CN원가율: (number | null)[];
    IMP원가율: (number | null)[];
    CN비중: (number | null)[];
    가중평균: (number | null)[];
  };
}

interface ApiResponse {
  brands?: Record<Brand, BrandData>;
  baseYear?: number;
  baseMonth?: number;
  error?: string;
}

const ROW_LABELS: Array<keyof BrandData['rows']> = ['CN원가율', 'IMP원가율', 'CN비중', '가중평균'];
const BRANDS: Brand[] = ['MLB', 'MLB KIDS'];

function formatRate(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '';
  return `${(v * 100).toFixed(1)}%`;
}

function fmtPct(v: number | null, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '-';
  return `${(v * 100).toFixed(digits)}%`;
}

function fmtPctDiff(v: number | null, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '-';
  const x = v * 100;
  const sign = x >= 0 ? '+' : '';
  return `${sign}${x.toFixed(digits)}%p`;
}

interface BrandMetrics {
  totalCnRate: number | null;
  totalImpRate: number | null;
  totalCnShare: number | null;
  totalWeighted: number | null;
  monthsCount: number;
  minCnRate: { month: string; value: number } | null;
  maxCnRate: { month: string; value: number } | null;
  maxCnShare: { month: string; value: number } | null;
  maxImpRate: { month: string; value: number } | null;
  // 26년 평균 CN비중 (없으면 null)
  avgCnShare26: number | null;
  // 25년 평균 CN비중
  avgCnShare25: number | null;
}

function computeMetrics(bd: BrandData | undefined): BrandMetrics {
  const empty: BrandMetrics = {
    totalCnRate: null, totalImpRate: null, totalCnShare: null, totalWeighted: null,
    monthsCount: 0, minCnRate: null, maxCnRate: null, maxCnShare: null, maxImpRate: null,
    avgCnShare26: null, avgCnShare25: null,
  };
  if (!bd) return empty;

  const totalIdx = bd.months.indexOf('전체');
  const result: BrandMetrics = {
    ...empty,
    totalCnRate: totalIdx >= 0 ? bd.rows.CN원가율[totalIdx] : null,
    totalImpRate: totalIdx >= 0 ? bd.rows.IMP원가율[totalIdx] : null,
    totalCnShare: totalIdx >= 0 ? bd.rows.CN비중[totalIdx] : null,
    totalWeighted: totalIdx >= 0 ? bd.rows.가중평균[totalIdx] : null,
  };

  const monthEntries = bd.months
    .map((m, i) => ({ m, i }))
    .filter((e) => e.m !== '전체');
  result.monthsCount = monthEntries.length;

  for (const { m, i } of monthEntries) {
    const cn = bd.rows.CN원가율[i];
    const cnShare = bd.rows.CN비중[i];
    const imp = bd.rows.IMP원가율[i];
    if (cn != null) {
      if (result.minCnRate === null || cn < result.minCnRate.value) result.minCnRate = { month: m, value: cn };
      if (result.maxCnRate === null || cn > result.maxCnRate.value) result.maxCnRate = { month: m, value: cn };
    }
    if (cnShare != null) {
      if (result.maxCnShare === null || cnShare > result.maxCnShare.value) result.maxCnShare = { month: m, value: cnShare };
    }
    if (imp != null) {
      if (result.maxImpRate === null || imp > result.maxImpRate.value) result.maxImpRate = { month: m, value: imp };
    }
  }

  // 연도별 CN비중 평균 (25년, 26년 구분)
  const shares25: number[] = [];
  const shares26: number[] = [];
  for (const { m, i } of monthEntries) {
    const v = bd.rows.CN비중[i];
    if (v == null) continue;
    if (m.startsWith('25년')) shares25.push(v);
    else if (m.startsWith('26년')) shares26.push(v);
  }
  result.avgCnShare25 = shares25.length > 0 ? shares25.reduce((a, b) => a + b, 0) / shares25.length : null;
  result.avgCnShare26 = shares26.length > 0 ? shares26.reduce((a, b) => a + b, 0) / shares26.length : null;
  return result;
}

interface AnalysisProps {
  brand: Brand;
  metrics: BrandMetrics;
  otherMetrics: BrandMetrics;
}

function AnalysisSection({ brand, metrics, otherMetrics }: AnalysisProps) {
  const other: Brand = brand === 'MLB' ? 'MLB KIDS' : 'MLB';
  const diffCn = (metrics.totalCnRate != null && otherMetrics.totalCnRate != null)
    ? metrics.totalCnRate - otherMetrics.totalCnRate : null;
  const diffShare = (metrics.totalCnShare != null && otherMetrics.totalCnShare != null)
    ? metrics.totalCnShare - otherMetrics.totalCnShare : null;
  const diffImp = (metrics.totalImpRate != null && otherMetrics.totalImpRate != null)
    ? metrics.totalImpRate - otherMetrics.totalImpRate : null;

  const cnHigherDesc = diffCn != null
    ? (diffCn > 0
        ? `${other}(${fmtPct(otherMetrics.totalCnRate)}) 대비 ${fmtPctDiff(Math.abs(diffCn))} 높음`
        : `${other}(${fmtPct(otherMetrics.totalCnRate)}) 대비 ${fmtPctDiff(Math.abs(diffCn))} 낮음`)
    : `${other}와 비교 불가`;
  const shareHigherDesc = diffShare != null
    ? (diffShare > 0
        ? `${other}(${fmtPct(otherMetrics.totalCnShare)}) 대비 ${fmtPctDiff(Math.abs(diffShare))} 높음`
        : `${other}(${fmtPct(otherMetrics.totalCnShare)}) 대비 ${fmtPctDiff(Math.abs(diffShare))} 낮음`)
    : `${other}와 비교 불가`;
  const isHigherShare = (diffShare ?? 0) > 0;

  const trendDesc = (metrics.avgCnShare25 != null && metrics.avgCnShare26 != null)
    ? `25년 평균 ${fmtPct(metrics.avgCnShare25, 1)} → 26년 평균 ${fmtPct(metrics.avgCnShare26, 1)}`
    : null;

  return (
    <div className="space-y-2">
      <div>
        <div className="font-medium text-slate-800">주요 지표</div>
        <ul className="ml-4 list-disc space-y-1 text-slate-600">
          <li>
            <span className="font-medium text-slate-700">CN원가율 평균 {fmtPct(metrics.totalCnRate)}</span>
            <span className="text-slate-500"> — {cnHigherDesc}</span>
          </li>
          <li>
            <span className="font-medium text-slate-700">CN비중 평균 {fmtPct(metrics.totalCnShare)}</span>
            <span className="text-slate-500"> — {shareHigherDesc}. {isHigherShare ? '현지생산 의존도 높음' : '본사 수입 비중 우세'}</span>
          </li>
          <li>
            <span className="font-medium text-slate-700">가중평균 원가율 {fmtPct(metrics.totalWeighted)} / IMP 원가율 {fmtPct(metrics.totalImpRate)}</span>
            {diffImp != null && (
              <span className="text-slate-500"> — IMP는 {other}({fmtPct(otherMetrics.totalImpRate)}) 대비 {fmtPctDiff(Math.abs(diffImp))} {diffImp > 0 ? '높음' : '낮음'}</span>
            )}
          </li>
        </ul>
      </div>
      <div>
        <div className="font-medium text-slate-800">수치 특이점</div>
        <ul className="ml-4 list-disc space-y-1 text-slate-600">
          {metrics.minCnRate && (
            <li>{metrics.minCnRate.month} CN 원가율 {fmtPct(metrics.minCnRate.value)} ({metrics.monthsCount}개월 중 최저)</li>
          )}
          {metrics.maxCnShare && (
            <li>{metrics.maxCnShare.month} CN비중 {fmtPct(metrics.maxCnShare.value)} ({metrics.monthsCount}개월 중 최고){trendDesc ? ` — ${trendDesc}` : ''}</li>
          )}
          {metrics.maxImpRate && metrics.totalImpRate != null && metrics.maxImpRate.value > metrics.totalImpRate * 1.10 && (
            <li>{metrics.maxImpRate.month} IMP 원가율 {fmtPct(metrics.maxImpRate.value)} — 전체 평균({fmtPct(metrics.totalImpRate)}) 대비 10%+ 상회, 검토 필요</li>
          )}
        </ul>
      </div>
      <div>
        <div className="font-medium text-slate-800">추천 액션</div>
        <ul className="ml-4 list-disc space-y-1 text-slate-600">
          {diffCn != null && (
            <li>CN 원가율 격차 분해 — {brand} {fmtPct(metrics.totalCnRate)} vs {other} {fmtPct(otherMetrics.totalCnRate)}, {fmtPctDiff(Math.abs(diffCn))} 차이를 단가/카테고리/공장별로 추가 분해</li>
          )}
          {isHigherShare ? (
            <li>CN생산 가속화 검증 — {brand} CN비중 추세 {trendDesc ?? '확인'}. 전략적 의도 vs 수입 라인업 축소 결과 점검</li>
          ) : (
            <li>IMP 원가율 안정성 모니터링 — {brand}는 IMP 비중이 높아 이전가격 변동에 민감</li>
          )}
          {diffImp != null && diffImp > 0.02 && (
            <li>{brand} IMP 원가율 점검 — 본사 이전가격이 {other}({fmtPct(otherMetrics.totalImpRate)}) 대비 {fmtPctDiff(Math.abs(diffImp))} 높음. 수입 SKU mix 또는 단가 원인 분석</li>
          )}
        </ul>
      </div>
    </div>
  );
}

interface ChartProps {
  months: string[]; // 25년1월, ... 26년4월 (전체 제외)
  cnRate: (number | null)[]; // CN원가율 (라인)
  cnShare: (number | null)[]; // CN비중 (막대)
}

function TrendChart({ months, cnRate, cnShare }: ChartProps) {
  const W = 500;
  const H = 240;
  const padT = 20;
  const padR = 42;
  const padB = 40;
  const padL = 38;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = months.length;

  // 스케일: 좌측 = CN비중(0~50%), 우측 = CN원가율(0~25%)
  const leftMax = 0.5;
  const rightMax = 0.25;

  const barGap = 2;
  const slotW = innerW / Math.max(n, 1);
  const barW = Math.max(slotW - barGap, 4);

  const yLeft = (v: number | null): number => {
    if (v == null) return padT + innerH;
    return padT + innerH - (v / leftMax) * innerH;
  };
  const yRight = (v: number | null): number => {
    if (v == null) return padT + innerH;
    return padT + innerH - (v / rightMax) * innerH;
  };
  const xCenter = (i: number): number => padL + slotW * (i + 0.5);

  // 라인 path (null 구간은 건너뜀)
  const linePath = cnRate
    .map((v, i) => (v == null ? null : `${i === 0 ? 'M' : 'L'}${xCenter(i)},${yRight(v)}`))
    .filter((s): s is string => s !== null)
    .join(' ')
    .replace(/L(?=.*M)/g, 'M'); // 결측 후 첫 점은 M

  // 좌측 Y축 눈금 (0, 10, 20, 30, 40, 50%)
  const leftTicks = [0, 0.1, 0.2, 0.3, 0.4, 0.5];
  const rightTicks = [0, 0.05, 0.1, 0.15, 0.2, 0.25];

  // X축 라벨: 첫 월/마지막 월/년도경계(N년1월)/중간(N년7월) 만 표시 — 데이터 범위 자동 적응
  const toShortLabel = (m: string): string => m.replace(/년/, '-').replace(/월/, '');
  const labelFor = (m: string, i: number): string | null => {
    if (i === 0 || i === n - 1) return toShortLabel(m);
    if (m.endsWith('년1월') || m.endsWith('년7월')) return toShortLabel(m);
    return null;
  };

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block">
      {/* 좌측 Y축 + grid */}
      {leftTicks.map((t) => (
        <g key={`lt-${t}`}>
          <line
            x1={padL}
            x2={padL + innerW}
            y1={yLeft(t)}
            y2={yLeft(t)}
            stroke="#e2e8f0"
            strokeWidth={1}
            strokeDasharray={t === 0 ? '' : '2 2'}
          />
          <text x={padL - 4} y={yLeft(t) + 3} fontSize={9} fill="#64748b" textAnchor="end">
            {(t * 100).toFixed(0)}%
          </text>
        </g>
      ))}
      {/* 우측 Y축 (CN원가율) */}
      {rightTicks.map((t) => (
        <text
          key={`rt-${t}`}
          x={padL + innerW + 4}
          y={yRight(t) + 3}
          fontSize={9}
          fill="#dc2626"
          textAnchor="start"
        >
          {(t * 100).toFixed(0)}%
        </text>
      ))}
      {/* CN비중 막대 */}
      {cnShare.map((v, i) => {
        if (v == null) return null;
        const y = yLeft(v);
        return (
          <rect
            key={`bar-${i}`}
            x={xCenter(i) - barW / 2}
            y={y}
            width={barW}
            height={padT + innerH - y}
            fill="#fbbf24"
            opacity={0.7}
          />
        );
      })}
      {/* CN원가율 라인 */}
      <path d={linePath} fill="none" stroke="#dc2626" strokeWidth={1.8} />
      {cnRate.map((v, i) =>
        v == null ? null : (
          <circle key={`pt-${i}`} cx={xCenter(i)} cy={yRight(v)} r={2.5} fill="#dc2626" />
        ),
      )}
      {/* X축 라벨 */}
      {months.map((m, i) => {
        const label = labelFor(m, i);
        if (!label) return null;
        return (
          <text
            key={`xl-${i}`}
            x={xCenter(i)}
            y={padT + innerH + 14}
            fontSize={9}
            fill="#64748b"
            textAnchor="middle"
          >
            {label}
          </text>
        );
      })}
      {/* 범례 */}
      <g transform={`translate(${padL}, ${H - 8})`}>
        <rect x={0} y={-6} width={10} height={6} fill="#fbbf24" opacity={0.7} />
        <text x={14} y={0} fontSize={9} fill="#64748b">CN비중 (좌)</text>
        <line x1={75} x2={88} y1={-3} y2={-3} stroke="#dc2626" strokeWidth={1.8} />
        <circle cx={81.5} cy={-3} r={2.5} fill="#dc2626" />
        <text x={92} y={0} fontSize={9} fill="#64748b">CN원가율 (우)</text>
      </g>
    </svg>
  );
}

export default function CumulativeCostRateTable() {
  const [data, setData] = useState<Record<Brand, BrandData> | null>(null);
  const [baseMonth, setBaseMonth] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeBrand, setActiveBrand] = useState<Brand>('MLB');

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    fetch('/api/pl-forecast/cumulative-cost-rate', { cache: 'no-store' })
      .then((r) => r.json())
      .then((json: ApiResponse) => {
        if (!mounted) return;
        if (json.error) {
          setError(json.error);
          return;
        }
        setData(json.brands ?? null);
        setBaseMonth(json.baseMonth ?? null);
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

  if (loading) {
    return (
      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
        누적원가율 로딩 중...
      </div>
    );
  }
  if (error) {
    return (
      <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        누적원가율 로딩 실패: {error}
      </div>
    );
  }
  if (!data) return null;

  const brandData = data[activeBrand];
  const months = brandData?.months ?? [];

  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/60 px-4 py-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="font-semibold text-slate-800">누적원가율</div>
          {baseMonth != null && (
            <code className="font-mono font-semibold text-blue-600 text-xs select-all">
              {`python scripts/refresh_2026_cumulative_cost_rate.py --baseMonth ${baseMonth}`}
            </code>
          )}
          <div className="text-xs text-slate-500">Snowflake → public/data/cumulative-cost-rate.json</div>
        </div>
        <div className="flex gap-1">
          {BRANDS.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setActiveBrand(b)}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                activeBrand === b
                  ? 'bg-slate-800 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-300'
              }`}
            >
              {b}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-[120px] border-b border-r border-slate-200 bg-navy px-3 py-2 text-center font-semibold text-white">
                구분
              </th>
              {months.map((m) => (
                <th
                  key={`cum-cost-h-${m}`}
                  className="min-w-[80px] border-b border-r border-slate-200 bg-navy px-2 py-2 text-center font-semibold text-white"
                >
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROW_LABELS.map((label) => {
              const values = brandData?.rows?.[label] ?? [];
              const isCnRow = label === 'CN원가율' || label === 'CN비중';
              const rowBg = isCnRow ? 'bg-yellow-50' : 'bg-white';
              return (
                <tr key={`cum-cost-r-${label}`} className={rowBg}>
                  <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-inherit px-3 py-2 font-medium text-slate-800">
                    {label}
                  </td>
                  {values.map((v, mi) => (
                    <td
                      key={`cum-cost-c-${label}-${mi}`}
                      className="border-b border-r border-slate-200 px-2 py-2 text-right text-slate-700"
                    >
                      {formatRate(v)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-slate-200 bg-slate-50/40 px-4 py-3 text-xs leading-relaxed text-slate-700">
        <div className="mb-2 font-semibold text-slate-800">{activeBrand} 분석</div>
        <div className="grid gap-4 lg:grid-cols-[1fr_500px]">
          <div>
            <AnalysisSection
              brand={activeBrand}
              metrics={computeMetrics(brandData)}
              otherMetrics={computeMetrics(data[activeBrand === 'MLB' ? 'MLB KIDS' : 'MLB'])}
            />
          </div>
          <div className="flex flex-col items-center justify-start">
            <div className="mb-1 text-[11px] font-medium text-slate-700">
              {activeBrand} CN 추세 ({months.filter((m) => m !== '전체').length}개월)
            </div>
            <TrendChart
              months={months.filter((m) => m !== '전체')}
              cnRate={(brandData?.rows?.CN원가율 ?? []).filter((_, i) => months[i] !== '전체')}
              cnShare={(brandData?.rows?.CN비중 ?? []).filter((_, i) => months[i] !== '전체')}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
