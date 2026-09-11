'use client';

// 지난달 보고 대비 모달 — "시나리오" 표 (부정 · 기존 · 긍정)
//
// 손익계산서와 같은 행 구조. 열은 시나리오 3묶음(부정 ▶ | YoY | 기존대비 / 기존 ▶ | YoY / 긍정 ▶ | YoY | 기존대비).
// 시나리오 헤더를 누르면 그 묶음이 1Q~4Q 열로 펼쳐지고, 셀 안에 본문처럼 전년비 금액·율이 인라인으로 붙는다.
// ±%p 는 직영·대리상 각각 스텝퍼로 바꾸고, 바꿀 때마다 즉석에서 다시 계산한다(서버 호출 없음).
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { PLScenarioResponse } from '@/app/api/fs/pl/scenario/route';
import {
  buildScenarios, annual, SCENARIO_ROWS,
  type ScenarioKey, type ScenarioParams, type ScenarioRowSpec, type Series,
} from '@/lib/pl-scenario';

const QUARTERS = ['1Q', '2Q', '3Q', '4Q'];
const MONTHS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

/** 표시 단위 — 계산은 늘 12개월 전체지만, 보여 줄 열만 고른다 */
export type ScenarioView = 'month' | 'quarter' | 'year';

interface PeriodCol {
  key: string;
  label: string;
  /** 결산 끝난 기간 — 세 시나리오가 같다 */
  isActual: boolean;
  get: (arr: number[] | undefined) => number;
}

/** 분기 합 (인덱스 0~3) */
function quarter(arr: number[] | undefined, q: number): number {
  if (!arr) return 0;
  let t = 0;
  for (let i = q * 3; i < q * 3 + 3; i += 1) t += arr[i] ?? 0;
  return t;
}

const SCENARIOS: { key: ScenarioKey; label: string; tone: { head: string; sub: string; text: string; annual: string } }[] = [
  // 부정·긍정은 색 계열만 남기고 톤을 낮춘다 — 진한 배경에 흰 글씨는 눈이 아프다
  { key: 'negative', label: '부정계획', tone: { head: 'bg-rose-100 text-rose-900', sub: 'bg-rose-50/60 text-rose-800', text: 'text-rose-800', annual: 'bg-rose-50' } },
  { key: 'current', label: '기존계획', tone: { head: 'bg-slate-200 text-slate-900', sub: 'bg-slate-100 text-slate-700', text: 'text-[#1e3a8a]', annual: 'bg-slate-100' } },
  { key: 'positive', label: '긍정계획', tone: { head: 'bg-emerald-100 text-emerald-900', sub: 'bg-emerald-50/60 text-emerald-800', text: 'text-emerald-800', annual: 'bg-emerald-50' } },
];

/** K위안, 음수 △ */
function fmtK(v: number | null | undefined, signed = false): string {
  if (v == null || !Number.isFinite(v)) return '–';
  const k = Math.round(v / 1000);
  const s = Math.abs(k).toLocaleString('ko-KR');
  if (k < 0) return `△${s}`;
  return signed && k > 0 ? `+${s}` : s;
}

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '–';
  return `${(v * 100).toFixed(1)}%`;
}

/** 비율 행의 %p 차이 */
function fmtPp(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '–';
  const p = v * 100;
  const s = Math.abs(p).toFixed(1);
  if (p < 0) return `△${s}%p`;
  return p > 0 ? `+${s}%p` : '0.0%p';
}

/** 기간 합계에서 비율(num ÷ den). 분모 0 이면 null */
function ratioOf(series: Series, spec: ScenarioRowSpec, pick: (arr: number[] | undefined) => number): number | null {
  if (!spec.ratio) return null;
  const den = pick(series[spec.ratio.den]);
  if (den === 0) return null;
  return pick(series[spec.ratio.num]) / den;
}

export function ScenarioStepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.max(0, Math.min(50, Math.round(v * 10) / 10)));
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
      <span className="font-semibold">{label}</span>
      <span className="inline-flex items-stretch overflow-hidden rounded-md border border-slate-300 bg-white">
        <button type="button" onClick={() => set(value - 1)} className="px-2 text-slate-500 hover:bg-slate-100" aria-label="감소">−</button>
        <input
          type="number"
          value={value}
          min={0}
          max={50}
          step={1}
          onChange={(e) => set(Number(e.target.value))}
          className="w-12 border-x border-slate-300 py-0.5 text-center text-xs tabular-nums outline-none"
        />
        <button type="button" onClick={() => set(value + 1)} className="px-2 text-slate-500 hover:bg-slate-100" aria-label="증가">+</button>
      </span>
      <span className="text-slate-500">%p</span>
    </label>
  );
}

interface Props {
  brand: string;
  year: number;
  /** ±%p — 모달 헤더의 스텝퍼가 쥐고 있다 */
  params: ScenarioParams;
  /** 월/분기/연간 — 모달 헤더의 전환탭이 쥐고 있다 */
  view: ScenarioView;
}

export default function PLScenarioPanel({ brand, year, params, view }: Props) {
  const [data, setData] = useState<PLScenarioResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 실적 기간(결산 끝난 달·분기)도 같이 보기 — 기본은 계획 기간만 */
  const [showActual, setShowActual] = useState(false);
  /** 접힌 부모 행 — 손익계산서처럼 기본 접힘 */
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(SCENARIO_ROWS.filter((r) => r.isExpandable).map((r) => r.account)),
  );

  useEffect(() => {
    let mounted = true;
    setError(null);
    fetch(`/api/fs/pl/scenario?brand=${brand}&year=${year}`, { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? '시나리오 데이터를 불러오지 못했습니다.');
        if (mounted) setData(json);
      })
      .catch((e) => { if (mounted) setError(e instanceof Error ? e.message : String(e)); });
    return () => { mounted = false; };
  }, [brand, year]);

  const result = useMemo(() => (data ? buildScenarios(data, params) : null), [data, params]);

  const toggleRow = (account: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(account)) next.delete(account);
      else next.add(account);
      return next;
    });

  // 접힌 부모의 하위 행을 숨긴다
  const visibleRows = useMemo(() => {
    const out: typeof SCENARIO_ROWS = [];
    let hideUnder = -1;
    for (const r of SCENARIO_ROWS) {
      if (hideUnder >= 0 && r.level > hideUnder) continue;
      hideUnder = -1;
      out.push(r);
      if (r.isExpandable && collapsed.has(r.account)) hideUnder = r.level;
    }
    return out;
  }, [collapsed]);

  if (error) return <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>;
  if (!result) return <p className="py-4 text-center text-xs text-slate-400">시나리오 계산 중…</p>;

  const baseMonth = result.baseMonth;
  const isPassthroughOnly = result.scenarioBrands.length === 0;

  // 보여 줄 열 — 기본은 계획월이 든 것만. 분기는 끝달이 기준월을 넘는 분기(8월 기준이면 3Q·4Q).
  // showActual 이면 실적 기간도 앞에 붙는다 (세 시나리오가 같으므로 회색).
  const isActualMonth = (i: number) => i < baseMonth;
  const isActualQuarter = (q: number) => (q + 1) * 3 <= baseMonth;
  const monthCols = MONTHS.map((_, i) => i).filter((i) => showActual || !isActualMonth(i));
  const quarterCols = QUARTERS.map((_, q) => q).filter((q) => showActual || !isActualQuarter(q));
  const periodCols: PeriodCol[] =
    view === 'month'
      ? monthCols.map((i) => ({ key: `m${i}`, label: MONTHS[i], isActual: isActualMonth(i), get: (arr) => arr?.[i] ?? 0 }))
      : view === 'quarter'
        ? quarterCols.map((q) => ({ key: `q${q}`, label: QUARTERS[q], isActual: isActualQuarter(q), get: (arr) => quarter(arr, q) }))
        : [];
  const hasActualPeriods = view === 'month' ? baseMonth > 0 : view === 'quarter' ? baseMonth >= 3 : false;

  const cellBase = 'border border-slate-200 px-2 py-1 text-right tabular-nums';
  /** 계정과목 | 부정 | 기존 | 긍정 사이 세로 구분선 — 각 묶음의 첫 칸 왼쪽에 굵게 */
  const groupStart = 'border-l-2 !border-l-slate-400';

  return (
    <section className="overflow-hidden rounded-lg border-2 border-indigo-200">
      {/* 제목 */}
      <div className="flex flex-wrap items-baseline gap-2 bg-indigo-50 px-4 py-2">
        <span className="text-sm font-bold text-indigo-900">시나리오</span>
        <span className="text-[11px] text-slate-500">
          {baseMonth + 1}~12월만 변동 · 1~{baseMonth}월은 실적 · K위안 · 직영 ±{params.directDelta}%p · 대리상 ACC ±{params.dealerDelta}%p
        </span>
      </div>

      {/* 기준 설명 — 간단히 */}
      <div className="border-b border-indigo-100 bg-white px-4 py-1.5 text-[11px] leading-relaxed text-slate-600">
        남은 달 합산 YoY(2026 계획 ÷ 2025 실적)에 ±%p 를 준 배율을 현재 계획의 각 달에 곱합니다 — 월 패턴 유지.
        직영 Tag·실판은 채널별 YoY, 대리상 의류는 고정(주문분), 대리상 ACC 만 YoY ±.
        매출원가는 월별 Tag 대비 원가율 고정. 직접비 변동비(급여·복리후생비 ← 직영OFF / 플랫폼·TP·직접광고 ← 직영ON / 대리상지원금 ← 대리상 / 물류비 ← 전체)는 월별 비용율 고정.
        평가감·고정비·영업비는 그대로. 리테일매출은 출고 Tag 배율을 그대로 따릅니다(직영=Tag 직영, 대리상=Tag 대리상).
        {isPassthroughOnly && <span className="ml-1 font-semibold text-amber-700">이 브랜드는 시나리오 대상이 아니라 세 열이 같습니다.</span>}
        {!isPassthroughOnly && brand === 'all' && (
          <span className="ml-1 text-slate-400">(DUVETICA·SUPRA 는 현재 그대로 합산)</span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            <tr>
              <th rowSpan={2} className="min-w-[170px] border border-slate-200 bg-slate-800 px-3 py-1.5 text-left font-semibold text-slate-100">
                계정과목
              </th>
              {SCENARIOS.map((sc) => {
                // 연간: 연간 | YoY | 대비.  월·분기: 기간열들 | 연간 | 대비 (YoY 는 셀 안에 인라인)
                const span = view === 'year'
                  ? 1 + 1 + (sc.key === 'current' ? 0 : 1)
                  : periodCols.length + 1 + (sc.key === 'current' ? 0 : 1);
                return (
                  <th
                    key={sc.key}
                    colSpan={span}
                    className={`border border-slate-200 px-3 py-1.5 text-center font-bold ${sc.tone.head} ${groupStart}`}
                  >
                    {sc.label}
                  </th>
                );
              })}
            </tr>
            <tr>
              {SCENARIOS.map((sc) => (
                <SubHeaders
                  key={sc.key}
                  sc={sc}
                  view={view}
                  periods={periodCols}
                  showActual={showActual}
                  canToggleActual={hasActualPeriods}
                  onToggleActual={() => setShowActual((v) => !v)}
                  groupStart={groupStart}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => {
              const cur = result.series.current[r.account];
              const prevAnnual = annual(result.prev[r.account]);
              const curAnnual = annual(cur);
              const isGroup = r.isExpandable === true;
              // 비율 행은 기간 합계에서 num÷den 으로 계산 — 브랜드 비율을 더하지 않는다
              const isRatio = !!r.ratio;
              const curRatioAnnual = isRatio ? ratioOf(result.series.current, r, annual) : null;
              const prevRatioAnnual = isRatio ? ratioOf(result.prev, r, annual) : null;
              // 본표(FinancialTable)와 같은 배경색·굵은 구분선. 하위 행은 연회색.
              const hl = r.highlight === 'sky' ? 'bg-highlight-sky'
                : r.highlight === 'mint' ? 'bg-highlight-mint'
                  : r.highlight === 'yellow' ? 'bg-highlight-yellow'
                    : r.highlight === 'orange' ? 'bg-highlight-orange'
                      : '';
              const rowTone = r.level > 0
                ? 'bg-slate-50 text-slate-600'
                : `${hl} ${r.isBold ? 'font-semibold text-slate-900' : 'text-slate-800'}`;
              const dividerCls = r.divider ? '[&>td]:!border-b-[3px] [&>td]:!border-b-slate-400' : '';
              return (
                <tr key={r.account} className={`${rowTone} ${dividerCls} ${r.level === 0 && !hl ? 'hover:bg-sky-50/40' : ''}`}>
                  <td
                    className={`border border-slate-200 py-1 pr-2 ${isGroup ? 'cursor-pointer' : ''}`}
                    style={{ paddingLeft: `${10 + r.level * 14}px` }}
                    onClick={isGroup ? () => toggleRow(r.account) : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {r.label}
                      {isGroup && (collapsed.has(r.account)
                        ? <ChevronRight className="h-3 w-3" strokeWidth={2.5} />
                        : <ChevronDown className="h-3 w-3" strokeWidth={2.5} />)}
                    </span>
                  </td>
                  {SCENARIOS.map((sc) => {
                    if (isRatio) {
                      return (
                        <RatioCells
                          key={sc.key}
                          sc={sc}
                          view={view}
                          periods={periodCols}
                          spec={r}
                          series={result.series[sc.key]}
                          prev={result.prev}
                          curRatioAnnual={curRatioAnnual}
                          prevRatioAnnual={prevRatioAnnual}
                          cellBase={cellBase}
                          groupStart={groupStart}
                        />
                      );
                    }
                    const s = result.series[sc.key][r.account];
                    const a = annual(s);
                    const yoy = prevAnnual !== 0 ? a / prevAnnual : null;
                    const diff = a - curAnnual;
                    return (
                      <SeriesCells
                        key={sc.key}
                        sc={sc}
                        view={view}
                        periods={periodCols}
                        series={s}
                        prevSeries={result.prev[r.account]}
                        annualValue={a}
                        yoy={yoy}
                        diff={diff}
                        cellBase={cellBase}
                        bold={!!r.isBold}
                        groupStart={groupStart}
                      />
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SubHeaders({ sc, view, periods, showActual, canToggleActual, onToggleActual, groupStart }: {
  sc: (typeof SCENARIOS)[number];
  view: ScenarioView;
  periods: PeriodCol[];
  showActual: boolean;
  canToggleActual: boolean;
  onToggleActual: () => void;
  groupStart: string;
}) {
  const th = `border border-slate-200 px-2 py-1 text-right text-[11px] font-semibold ${sc.tone.sub}`;
  return (
    <>
      {view !== 'year' && periods.map((p, idx) => (
        <th key={p.key} className={`${th} min-w-[96px] ${p.isActual ? 'text-slate-400' : ''} ${idx === 0 ? groupStart : ''}`}>
          <span className="inline-flex items-center justify-end gap-1">
            {/* 첫 기간 헤더에 실적 토글 — 세 묶음 어디를 눌러도 같이 움직인다 */}
            {idx === 0 && canToggleActual && (
              <button
                type="button"
                onClick={onToggleActual}
                title={showActual ? '실적 기간 접기' : '실적 기간(결산 완료)도 보기'}
                className="rounded border border-current/30 px-1 py-px text-[9px] font-bold leading-none opacity-70 hover:opacity-100"
              >
                {showActual ? '실적 ▸' : '◂ 실적'}
              </button>
            )}
            {p.label}
          </span>
        </th>
      ))}
      <th className={`${th} min-w-[96px] ${view === 'year' ? groupStart : ''}`}>연간</th>
      {view === 'year' && <th className={`${th} min-w-[56px]`}>YoY</th>}
      {sc.key !== 'current' && <th className={`${th} min-w-[76px]`}>기존계획대비</th>}
    </>
  );
}

/** 본문 분기 셀과 같은 형식 — 위에 값, 아래에 전년비 금액·율 */
function InlineYoyCell({ value, prev, cellBase, bold, tone, dim, bg }: {
  value: number; prev: number; cellBase: string; bold: boolean; tone?: string; dim?: boolean; bg?: string;
}) {
  const yoyAmt = value - prev;
  const yoyPct = prev !== 0 ? value / prev : null;
  const amtTone = Math.round(yoyAmt / 1000) === 0 ? 'text-slate-400' : yoyAmt > 0 ? 'text-emerald-600' : 'text-rose-600';
  const pctTone = yoyPct == null ? 'text-slate-400' : yoyPct < 1 ? 'text-rose-600' : yoyPct > 1 ? 'text-emerald-600' : 'text-slate-500';
  return (
    <td className={`${cellBase} ${bold ? 'font-semibold' : ''} ${dim ? 'bg-slate-100/70' : bg ?? ''}`}>
      <div className="flex flex-col items-end">
        <div className={`${tone ?? ''} ${value < 0 ? 'text-rose-600' : ''}`}>{fmtK(value)}</div>
        <div className="mt-0.5 text-[10px] leading-tight">
          <span className={amtTone}>{fmtK(yoyAmt, true)}</span>
          {yoyPct != null && (
            <>
              <span className="mx-0.5 text-slate-300">,</span>
              <span className={pctTone}>{Math.round(yoyPct * 100)}%</span>
            </>
          )}
        </div>
      </div>
    </td>
  );
}

/** 비율 행 — 값은 %, 전년비·기존대비는 %p */
function RatioCells({ sc, view, periods, spec, series, prev, curRatioAnnual, prevRatioAnnual, cellBase, groupStart }: {
  sc: (typeof SCENARIOS)[number];
  view: ScenarioView;
  periods: PeriodCol[];
  spec: ScenarioRowSpec;
  series: Series;
  prev: Series;
  curRatioAnnual: number | null;
  prevRatioAnnual: number | null;
  cellBase: string;
  groupStart: string;
}) {
  const a = ratioOf(series, spec, annual);
  const yoyPp = a != null && prevRatioAnnual != null ? a - prevRatioAnnual : null;
  const diffPp = a != null && curRatioAnnual != null ? a - curRatioAnnual : null;
  const ppTone = (v: number | null) =>
    v == null || Math.abs(v * 1000) < 0.5 ? 'text-slate-400' : v > 0 ? 'text-emerald-600' : 'text-rose-600';
  const cell = (value: number | null, pp: number | null, dim?: boolean, tone?: string, key?: string, bg?: string, first?: boolean) => (
    <td key={key} className={`${cellBase} ${first ? groupStart : ''} font-semibold ${dim ? 'bg-slate-100/70' : bg ?? ''}`}>
      <div className="flex flex-col items-end">
        <div className={tone ?? ''}>{fmtPct(value)}</div>
        <div className={`mt-0.5 text-[10px] leading-tight ${ppTone(pp)}`}>{fmtPp(pp)}</div>
      </div>
    </td>
  );
  if (view !== 'year') {
    return (
      <>
        {periods.map((p, idx) => {
          const v = ratioOf(series, spec, p.get);
          const pv = ratioOf(prev, spec, p.get);
          return cell(v, v != null && pv != null ? v - pv : null, p.isActual, undefined, p.key, undefined, idx === 0);
        })}
        {cell(a, yoyPp, false, sc.tone.text, undefined, sc.tone.annual)}
        {sc.key !== 'current' && (
          <td className={`${cellBase} ${ppTone(diffPp)}`}>{fmtPp(diffPp)}</td>
        )}
      </>
    );
  }
  return (
    <>
      <td className={`${cellBase} ${groupStart} font-semibold ${sc.tone.text} ${sc.tone.annual}`}>{fmtPct(a)}</td>
      <td className={`${cellBase} ${ppTone(yoyPp)}`}>{fmtPp(yoyPp)}</td>
      {sc.key !== 'current' && (
        <td className={`${cellBase} ${ppTone(diffPp)}`}>{fmtPp(diffPp)}</td>
      )}
    </>
  );
}

function SeriesCells({
  sc, view, periods, series, prevSeries, annualValue, yoy, diff, cellBase, bold, groupStart,
}: {
  sc: (typeof SCENARIOS)[number];
  view: ScenarioView;
  periods: PeriodCol[];
  series: number[] | undefined;
  prevSeries: number[] | undefined;
  annualValue: number;
  yoy: number | null;
  diff: number;
  cellBase: string;
  bold: boolean;
  groupStart: string;
}) {
  const b = bold ? 'font-semibold' : '';
  const diffTone = Math.round(diff / 1000) === 0 ? 'text-slate-400' : diff > 0 ? 'text-emerald-600' : 'text-rose-600';
  const prevAnnual = annual(prevSeries);
  if (view !== 'year') {
    return (
      <>
        {periods.map((p, idx) => (
          <InlineYoyCell
            key={p.key}
            value={p.get(series)}
            prev={p.get(prevSeries)}
            cellBase={`${cellBase} ${idx === 0 ? groupStart : ''}`}
            bold={bold}
            dim={p.isActual}
          />
        ))}
        <InlineYoyCell value={annualValue} prev={prevAnnual} cellBase={cellBase} bold={bold} tone={sc.tone.text} bg={sc.tone.annual} />
        {sc.key !== 'current' && (
          <td className={`${cellBase} ${diffTone}`}>{fmtK(diff, true)}</td>
        )}
      </>
    );
  }
  return (
    <>
      <td className={`${cellBase} ${groupStart} ${b} ${sc.tone.text} ${sc.tone.annual}`}>{fmtK(annualValue)}</td>
      <td className={`${cellBase} text-slate-500`}>{fmtPct(yoy)}</td>
      {sc.key !== 'current' && (
        <td className={`${cellBase} ${diffTone}`}>{fmtK(diff, true)}</td>
      )}
    </>
  );
}
