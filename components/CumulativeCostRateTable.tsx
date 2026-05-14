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
  error?: string;
}

const ROW_LABELS: Array<keyof BrandData['rows']> = ['CN원가율', 'IMP원가율', 'CN비중', '가중평균'];
const BRANDS: Brand[] = ['MLB', 'MLB KIDS'];

function formatRate(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '';
  return `${(v * 100).toFixed(1)}%`;
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

  // X축 라벨: 너무 많아서 25년/26년 시작과 끝, 분기마다만 표시
  const labelFor = (m: string, i: number): string | null => {
    if (i === 0) return '25-1';
    if (i === n - 1) return m.replace(/년/, '-').replace(/월/, '');
    if (m === '25년7월') return '25-7';
    if (m === '26년1월') return '26-1';
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
        <div>
          <div className="font-semibold text-slate-800">누적원가율</div>
          <div className="mt-0.5 text-xs text-slate-500">파일/누적원가율.csv</div>
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
        {activeBrand === 'MLB' ? (
          <div className="space-y-2">
            <div>
              <div className="font-medium text-slate-800">주요 지표</div>
              <ul className="ml-4 list-disc space-y-1 text-slate-600">
                <li>
                  <span className="font-medium text-slate-700">CN원가율 평균 14.8%</span>
                  <span className="text-slate-500"> — MLB Kids(19.5%) 대비 5%p 낮음. MLB 본 라인은 평균 단가가 높아 중국 현지 생산 시 원가율 부담이 상대적으로 작음</span>
                </li>
                <li>
                  <span className="font-medium text-slate-700">CN비중 평균 16.7%</span>
                  <span className="text-slate-500"> — MLB Kids(27.3%) 대비 10.6%p 낮음. 본 라인은 본사 수입 비중이 압도적</span>
                </li>
                <li>
                  <span className="font-medium text-slate-700">가중평균 원가율 35.2% / IMP 원가율 39.3%</span>
                  <span className="text-slate-500"> — IMP 비중(83%)이 높지만 IMP 원가율 자체가 안정적이라 가중평균이 양호</span>
                </li>
              </ul>
            </div>
            <div>
              <div className="font-medium text-slate-800">수치 특이점</div>
              <ul className="ml-4 list-disc space-y-1 text-slate-600">
                <li>25-11월 CN 원가율 12.8% (16개월 중 최저) — 시즌 마감 효과 추정</li>
                <li>26-4월 CN 원가율 14.1%로 하향 추세 — 본사 수입 비중 17.6% 대비 변동성 적음</li>
              </ul>
            </div>
            <div>
              <div className="font-medium text-slate-800">추천 액션</div>
              <ul className="ml-4 list-disc space-y-1 text-slate-600">
                <li>CN 원가율 격차 분해 — MLB 14.8% vs Kids 19.5%, 5%p 차이를 단가/카테고리/공장별로 추가 분해</li>
                <li>IMP 원가율 안정성 모니터링 — 본 라인이 IMP 비중이 높아 이전가격 변동에 민감</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div>
              <div className="font-medium text-slate-800">주요 지표</div>
              <ul className="ml-4 list-disc space-y-1 text-slate-600">
                <li>
                  <span className="font-medium text-slate-700">CN원가율 평균 19.5%</span>
                  <span className="text-slate-500"> — MLB(14.8%) 대비 5%p 높음. 키즈 의류는 평균 단가가 낮아 원가율 부담이 큼. 중국 현지 생산도 키즈는 생산 효율이 낮을 가능성</span>
                </li>
                <li>
                  <span className="font-medium text-slate-700">CN비중 평균 27.3%</span>
                  <span className="text-slate-500"> — MLB(16.7%) 대비 10.6%p 높음, 1.6배 수준. 키즈 SKU의 중국 적합도가 높거나 본사 수입 모델 수가 적음</span>
                </li>
                <li>
                  <span className="font-medium text-slate-700">가중평균 원가율 36.2% / IMP 원가율 42.5%</span>
                  <span className="text-slate-500"> — CN/IMP 양쪽 원가율이 모두 높지만 CN비중이 높아 부분 상쇄. IMP 42.5%는 마진 압박 요인</span>
                </li>
              </ul>
            </div>
            <div>
              <div className="font-medium text-slate-800">수치 특이점</div>
              <ul className="ml-4 list-disc space-y-1 text-slate-600">
                <li>25-3월 IMP 원가율 46.6% (이상치) — 검토 필요</li>
                <li>26-4월 CN비중 43.5% (16개월 중 최고) — 키즈 현지생산 가속화 신호 (25년 평균 ~25% → 26년 4월 43.5%)</li>
              </ul>
            </div>
            <div>
              <div className="font-medium text-slate-800">추천 액션</div>
              <ul className="ml-4 list-disc space-y-1 text-slate-600">
                <li>IMP 원가율 점검 — 본사 이전가격이 MLB(39.3%) 대비 3.2%p 높은 원인 분석 (수입 키즈 SKU mix vs 단가)</li>
                <li>키즈 CN생산 가속화 검증 — 26년 CN비중 25%→44% 추세가 전략적 의도인지, 수입 라인업 축소 결과인지 확인</li>
              </ul>
            </div>
          </div>
        )}
        </div>
        <div className="flex flex-col items-center justify-start">
          <div className="mb-1 text-[11px] font-medium text-slate-700">{activeBrand} CN 추세 (16개월)</div>
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
