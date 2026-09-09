'use client';

// 지난달 보고 대비 — 현재 버전(2026.csv) vs 전월 버전(2026_기존.csv, 지난달 보고본)
//   2×2 배치 — 위: ① 전월대비(현재 − 전월) | 영업이익 Bridge, 아래: ② 현재버전 | ③ 전월버전
//   상단 탭으로 법인/브랜드를 전환한다.
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import type { PLCompareResponse } from '@/app/api/fs/pl/compare/route';
import { BASE_MONTH } from '@/lib/base-month';
import { buildCompareAnalysis, buildCompareBridge, buildCompareSummary } from '@/lib/pl-compare-analysis';
import PLCompareBridge from './PLCompareBridge';

const QUARTERS = ['1Q', '2Q', '3Q', '4Q'];

/**
 * 결산이 끝나 양쪽 버전 값이 같아지는 분기 수. 기준월 8월이면 1Q·2Q.
 * 이 분기들은 전월대비가 항상 0이라 기본으로 접어 둔다.
 */
const CLOSED_QUARTERS = Math.floor(BASE_MONTH / 3);

const TABS: { key: string; label: string }[] = [
  { key: 'all', label: '법인' },
  { key: 'mlb', label: 'MLB' },
  { key: 'kids', label: 'MLB KIDS' },
  { key: 'discovery', label: 'DISCOVERY' },
  { key: 'duvetica', label: 'DUVETICA' },
  { key: 'supra', label: 'SUPRA' },
];

/** 12개월 → 분기 4개 (전부 null 이면 null) */
function toQuarters(values: (number | null)[]): (number | null)[] {
  return QUARTERS.map((_, q) => {
    let sum = 0;
    let has = false;
    for (let i = q * 3; i < q * 3 + 3; i += 1) {
      const v = values[i];
      if (v != null && !Number.isNaN(v)) { sum += v; has = true; }
    }
    return has ? sum : null;
  });
}

function annual(values: (number | null)[]): number | null {
  let sum = 0;
  let has = false;
  for (const v of values) if (v != null && !Number.isNaN(v)) { sum += v; has = true; }
  return has ? sum : null;
}

/** K위안, 음수는 △ (대시보드 표기 규칙) */
function fmtK(v: number | null, showSign = false): string {
  if (v == null || Number.isNaN(v)) return '–';
  const k = Math.round(v / 1000);
  const s = new Intl.NumberFormat('ko-KR').format(Math.abs(k));
  if (k < 0) return '△' + s;
  return showSign && k > 0 ? '+' + s : s;
}

function diffTone(v: number | null): string {
  if (v == null || Math.round(v / 1000) === 0) return 'text-slate-400';
  return v > 0 ? 'text-emerald-600' : 'text-rose-600';
}

interface Props {
  year: number;
  onClose: () => void;
}

export default function PLVersionCompareModal({ year, onClose }: Props) {
  const [brand, setBrand] = useState<string>('all');
  // 하위 행은 기본 접힘 — 손익계산서와 동일
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(['Tag매출', '실판매출', '매출원가 합계', '매출원가', '평가감(환입)', '직접비', '영업비']),
  );
  // 결산 끝난 분기(1Q·2Q)는 전월대비가 0이라 기본 숨김
  const [showClosedQuarters, setShowClosedQuarters] = useState(false);
  // Bridge 막대 클릭 → 아래에 구성 항목 표
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const toggle = (account: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(account)) next.delete(account);
      else next.add(account);
      return next;
    });
  const [data, setData] = useState<PLCompareResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/fs/pl/compare?brand=${brand}&year=${year}`, { cache: 'no-store' });
        const json = await res.json();
        if (!mounted) return;
        if (!res.ok) throw new Error(json?.error ?? '지난달 보고 대비 데이터를 불러오지 못했습니다.');
        setData(json);
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : '지난달 보고 대비 데이터를 불러오지 못했습니다.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [brand, year]);

  // 탭을 바꾸면 구성이 달라지므로 펼침을 접는다
  useEffect(() => { setSelectedStep(null); }, [brand]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 숨긴 분기는 열 자체를 빼고 그린다 (연간 열은 12개월 전체 합이라 그대로)
  const visibleQuarters = QUARTERS
    .map((label, index) => ({ label, index }))
    .filter(({ index }) => showClosedQuarters || index >= CLOSED_QUARTERS);

  const allRows = data?.rows ?? [];
  // 접힌 부모(Tag매출/실판매출)의 채널 행은 숨긴다
  const rows = (() => {
    const out: typeof allRows = [];
    let hideUnderLevel = -1;
    for (const r of allRows) {
      if (hideUnderLevel >= 0 && r.level > hideUnderLevel) continue;
      hideUnderLevel = -1;
      out.push(r);
      if (r.isExpandable && collapsed.has(r.account)) hideUnderLevel = r.level;
    }
    return out;
  })();
  const changed = data?.baselineBrands ?? [];
  // 분석은 접힘 상태와 무관하게 전체 행으로 계산한다
  const analysis = data
    ? buildCompareAnalysis({
        rows: allRows,
        details: data.bridgeDetails,
        brand,
        baselineBrands: data.baselineBrands ?? [],
        closedQuarters: CLOSED_QUARTERS,
      })
    : [];
  const bridge = data ? buildCompareBridge(allRows) : null;
  const summary = data
    ? buildCompareSummary({ rows: allRows, details: data.bridgeDetails, brand, baselineBrands: [], closedQuarters: CLOSED_QUARTERS })
    : [];
  const detail = selectedStep ? data?.bridgeDetails?.[selectedStep] ?? [] : [];
  const brandChanged = brand === 'all' ? changed.length > 0 : changed.includes(brand);

  /**
   * 한 버전을 독립된 표 카드로 렌더.
   * 색 테두리 + 제목바로 3개 표가 눈에 바로 끊겨 보이게 한다.
   */
  const table = (
    title: string,
    pick: (r: PLCompareResponse['rows'][number]) => (number | null)[],
    tone: { head: string; ring: string; th: string },
    diff = false,
  ) => (
    <section className={`overflow-hidden rounded-lg border-2 ${tone.ring}`}>
      <div className={`px-4 py-2 text-[13px] font-bold tracking-wide ${tone.head}`}>{title}</div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className={`w-[190px] border border-slate-200 px-3 py-1.5 text-left text-xs font-semibold ${tone.th}`}>
              계정과목
            </th>
            {visibleQuarters.map(({ label }) => (
              <th key={label} className={`border border-slate-200 px-3 py-1.5 text-right text-xs font-semibold ${tone.th}`}>
                {label}
              </th>
            ))}
            <th className={`border border-slate-200 px-3 py-1.5 text-right text-xs font-semibold ${tone.th}`}>
              연간
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const v = pick(r);
            const q = toQuarters(v);
            const a = annual(v);
            const isBold = r.account === '영업이익(관리식)' || r.account === '매출총이익';
            const isGroupRow = r.isExpandable === true;
            // 펼친 채널 행은 배경·글씨를 달리해 상위 계정과 구분한다
            // 하위 행은 배경을 깔아 상위 계정과 끊어 보이게 한다.
            //   브랜드·채널 = 본 계정과 다른 축(참고) → 이탤릭까지
            //   비용 세부항목 = 부모의 실제 구성 → 정체 유지, 배경만
            const childTone = r.isReference
              ? 'bg-slate-100/80 text-[11px] italic text-slate-500'
              : r.level > 0
                ? 'bg-slate-50 text-[11px] text-slate-600'
                : '';
            return (
              <tr key={`${title}-${r.account}`} className={r.isReference || r.level > 0 ? '' : 'hover:bg-sky-50/40'}>
                <td
                  className={`border border-slate-200 py-1.5 pr-3 ${childTone} ${isGroupRow ? 'cursor-pointer' : ''} ${
                    isBold ? 'font-semibold text-slate-800' : r.isReference ? '' : 'text-slate-700'
                  }`}
                  style={{ paddingLeft: `${12 + r.level * 16}px` }}
                  onClick={isGroupRow ? () => toggle(r.account) : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {r.label}
                    {isGroupRow && (
                      collapsed.has(r.account)
                        ? <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
                        : <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.5} />
                    )}
                  </span>
                </td>
                {visibleQuarters.map(({ index }) => {
                  const val = q[index];
                  return (
                  <td
                    key={index}
                    className={`border border-slate-200 px-3 py-1.5 text-right tabular-nums ${childTone} ${
                      diff ? diffTone(val) : r.isReference || r.level > 0 ? '' : val != null && val < 0 ? 'text-rose-600' : 'text-slate-800'
                    } ${isBold ? 'font-semibold' : ''}`}
                  >
                    {fmtK(val, diff)}
                  </td>
                  );
                })}
                <td
                  className={`border border-slate-200 px-3 py-1.5 text-right font-semibold tabular-nums ${childTone || 'bg-slate-50/60'} ${
                    diff ? diffTone(a) : r.isReference || r.level > 0 ? '' : a != null && a < 0 ? 'text-rose-600' : 'text-slate-800'
                  }`}
                >
                  {fmtK(a, diff)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-[1440px] overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">지난달 보고 대비 — {year}년</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              단위 K위안 · 현재 버전(2026.csv) vs 전월 버전(2026_기존.csv, 지난달 보고본)
              {changed.length > 0 && ` · 계획이 바뀐 브랜드: ${changed.map(b => b.toUpperCase()).join(', ')}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 법인 · 브랜드 전환탭 — iOS 세그먼티드 컨트롤 (진한 네이비 트랙) */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-2.5">
          <div className="inline-flex items-center gap-0.5 rounded-xl bg-[#34506F] p-1 shadow-inner">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setBrand(t.key)}
                className={`rounded-lg px-3.5 py-1 text-xs font-semibold transition-all duration-150 ${
                  brand === t.key
                    ? 'bg-white text-[#34506F] shadow-sm'
                    : 'text-slate-200 hover:bg-white/10 hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* 결산 끝난 분기는 두 버전 값이 같아 전월대비가 0 — 기본 숨김 */}
          {CLOSED_QUARTERS > 0 && (
            <button
              type="button"
              onClick={() => setShowClosedQuarters((v) => !v)}
              className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                showClosedQuarters
                  ? 'border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200'
                  : 'border-slate-300 bg-white text-slate-500 hover:bg-slate-50'
              }`}
              title={`${QUARTERS.slice(0, CLOSED_QUARTERS).join('·')} 는 결산이 끝나 현재 버전과 전월 보고본이 같습니다 (전월대비 0)`}
            >
              {showClosedQuarters ? '실적 분기 숨기기' : `실적 분기 보기 (${QUARTERS.slice(0, CLOSED_QUARTERS).join('·')})`}
            </button>
          )}
        </div>

        <div className="max-h-[calc(90vh-130px)] overflow-auto p-5">
          {loading && <p className="py-10 text-center text-sm text-slate-500">불러오는 중…</p>}
          {error && <p className="py-10 text-center text-sm text-rose-600">{error}</p>}

          {!loading && !error && (
            <>
              {!brandChanged && (
                <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  이 브랜드는 전월 버전 파일이 없어 계획 변경이 없습니다 — 현재 = 전월.
                </p>
              )}
              {/* 연간 증감 요약 — 표 위 전체 폭 띠. 경영요약(summary) 카드처럼 가로로 편다 */}
              {analysis.length > 0 && (
                <section className="mb-4 overflow-hidden rounded-lg border border-emerald-200">
                  <div className="bg-emerald-50 px-4 py-2.5 text-slate-800">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-bold tracking-wide text-emerald-900">설명과 분석</span>
                      <span className="shrink-0 text-[11px] text-slate-500">연간 기준 · 증감 = 현재 − 전월 · K위안</span>
                    </div>
                    {/* 서술형 요약 — 숫자에서 바로 나오는 것과 원인 해석을 꼬리표로 구분한다 */}
                    {summary.length > 0 && (
                      <ul className="mt-2 space-y-1.5">
                        {summary.map((sn, i) => (
                          <li key={i} className="flex items-start gap-2 text-[13px] leading-relaxed">
                            {/* 데이터 문장은 꼬리표 없이, 해석이 섞인 문장만 '추정' 으로 표시한다 */}
                            {sn.kind === 'estimate' && (
                              <span className="mt-0.5 shrink-0 rounded bg-amber-400 px-1.5 py-px text-[11px] font-bold text-amber-950">
                                추정
                              </span>
                            )}
                            <span className={sn.kind === 'data' ? 'text-slate-900' : 'text-amber-900'}>{sn.text}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="grid grid-cols-1 divide-y divide-slate-200 bg-white sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 xl:grid-cols-8 sm:divide-x">
                    {analysis.map((sec) => (
                      <div key={sec.title} className={`min-w-0 px-3 py-2.5 ${sec.wide ? 'xl:col-span-2' : ''}`}>
                        {/* 제목과 금액을 한 줄에 두면 보조 지표가 붙을 때 제목이 밀린다 → 두 줄로 */}
                        <div className="mb-1">
                          <div className="text-xs font-bold text-slate-800">{sec.title}</div>
                          {sec.headline != null && (
                            <div className="flex flex-wrap items-baseline gap-x-1.5">
                              <span className={`text-sm font-bold tabular-nums ${
                                sec.headlineTone === 'up' ? 'text-emerald-600'
                                  : sec.headlineTone === 'down' ? 'text-rose-600'
                                  : 'text-slate-400'
                              }`}>
                                {fmtK(sec.headline * 1000, true)}
                              </span>
                              {sec.headlineNote && (
                                <span className="text-[10px] font-medium text-slate-500">({sec.headlineNote})</span>
                              )}
                            </div>
                          )}
                        </div>
                        <ul className="space-y-1">
                          {sec.lines.map((ln, i) => (
                            <li key={i} className="text-[11px] leading-snug">
                              <span
                                className={`${ln.sub ? 'text-slate-600' : 'font-semibold text-slate-900'} ${
                                  ln.tone === 'up' ? 'text-emerald-700' : ln.tone === 'down' ? 'text-rose-700' : ''
                                }`}
                              >
                                {ln.sub && <span className="mr-0.5 text-slate-400">ㄴ</span>}
                                {ln.text}
                              </span>
                              {/* 브랜드·채널·계정은 한 줄씩 — 이름 왼쪽, 금액 오른쪽 정렬 */}
                              {ln.items && ln.items.length > 0 && (
                                <div className="mt-0.5 space-y-px pl-3">
                                  {ln.items.map((it) => (
                                    <div key={it.label} className="flex items-baseline justify-between gap-2">
                                      <span className="min-w-0 truncate text-slate-800">
                                        {it.label}
                                        {it.note && (
                                          <span className="ml-1 text-[10px] text-slate-400">({it.note})</span>
                                        )}
                                      </span>
                                      <span
                                        className={`shrink-0 font-semibold tabular-nums ${
                                          it.value > 0
                                            ? 'text-emerald-700'
                                            : it.value < 0
                                              ? 'text-rose-700'
                                              : 'text-slate-400'
                                        }`}
                                      >
                                        {fmtK(it.value * 1000, true)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* 2×2 배치 — 위: 전월대비 | Bridge, 아래: 현재 버전 | 전월 버전 */}
              <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
              <div className="min-w-0">
                {table(
                  '① 전월대비 (현재 − 전월)',
                  (r) => r.current.map((v, i) => {
                    const b = r.baseline[i];
                    if (v == null && b == null) return null;
                    return (v ?? 0) - (b ?? 0);
                  }),
                  { head: 'bg-amber-500 text-white', ring: 'border-amber-300', th: 'bg-amber-50 text-amber-900' },
                  true,
                )}
              </div>

              {/* 우측 상단: 영업이익 Bridge — 좌측 표와 같은 데이터에서 파생 */}
              <aside className="min-w-0">
                {/* 영업이익 Bridge — 전월 → 현재 (연간) */}
                {bridge && (
                  <div className="overflow-hidden rounded-lg border-2 border-indigo-300">
                    <div className="flex items-center justify-between gap-2 bg-indigo-600 px-4 py-2 text-white">
                      <span className="text-[13px] font-bold tracking-wide">영업이익 Bridge</span>
                      <span className="text-[10px] text-indigo-100">전월 → 현재 · K위안</span>
                    </div>
                    <div className="bg-white px-2 pb-1 pt-2">
                      {/* 영업이익 절대금액은 요인의 수십 배라 막대로 그리지 않고 숫자로 낸다 */}
                      <div className="mb-1 flex items-center justify-center gap-2 px-2 text-sm">
                        <span className="text-slate-500">전월</span>
                        <span className="font-bold tabular-nums text-slate-700">{fmtK(bridge.op0)}</span>
                        <span className={`rounded px-1.5 py-0.5 text-xs font-bold tabular-nums ${
                          bridge.op1 - bridge.op0 > 0
                            ? 'bg-emerald-50 text-emerald-700'
                            : bridge.op1 - bridge.op0 < 0
                              ? 'bg-rose-50 text-rose-700'
                              : 'bg-slate-100 text-slate-500'
                        }`}>
                          {fmtK(bridge.op1 - bridge.op0, true)}
                        </span>
                        <span className="text-slate-300">→</span>
                        <span className="text-slate-500">현재</span>
                        <span className="font-bold tabular-nums text-slate-900">{fmtK(bridge.op1)}</span>
                      </div>
                      {/* 막대가 눌린다는 걸 모르고 지나치기 쉬워 눈에 띄게 안내한다 */}
                      {!selectedStep && (
                        <div className="mx-1 mb-1 flex items-center justify-center gap-1.5 rounded-md bg-indigo-50 py-1 text-[11px] font-semibold text-indigo-700">
                          <span aria-hidden className="text-sm leading-none">👆</span>
                          막대를 클릭하면 구성 내역이 열립니다
                        </div>
                      )}
                      <PLCompareBridge
                        steps={bridge.steps}
                        selected={selectedStep}
                        onSelect={setSelectedStep}
                      />

                      {/* 막대 클릭 시 구성 항목 — 전 항목 + 전월/현재/증감 */}
                      {selectedStep && (
                        <div className="mx-1 mb-2 overflow-hidden rounded-md border border-indigo-200">
                          <div className="flex items-center justify-between bg-indigo-50 px-2 py-1">
                            <span className="text-[11px] font-bold text-indigo-900">
                              {selectedStep} 구성 · {brand === 'all' ? '브랜드별' : selectedStep === '평가감' ? '설정/환입' : '채널별'}
                              {(selectedStep === '직접비' || selectedStep === '영업비') && ' 계정별'}
                            </span>
                            <button
                              type="button"
                              onClick={() => setSelectedStep(null)}
                              className="rounded px-1.5 text-[11px] text-indigo-500 hover:bg-indigo-100"
                            >
                              닫기
                            </button>
                          </div>
                          {/* 표는 계정 기준 증감, 막대는 이익 효과 — 원가·비용은 부호가 반대라 짚어 준다 */}
                          {selectedStep !== 'V−' && detail.length > 0 && (
                            <p className="border-b border-slate-100 bg-white px-2 py-1 text-[10px] text-slate-400">
                              증감은 계정 기준입니다 — 줄어들면(△) 영업이익은 그만큼 늘어납니다.
                            </p>
                          )}
                          {detail.length === 0 ? (
                            <p className="px-2 py-2 text-[11px] text-slate-400">구성 데이터가 없습니다.</p>
                          ) : (
                            <table className="w-full border-collapse text-[11px]">
                              <thead>
                                <tr className="bg-slate-50 text-slate-500">
                                  <th className="px-2 py-1 text-left font-semibold">구분</th>
                                  <th className="px-2 py-1 text-right font-semibold">전월</th>
                                  <th className="px-2 py-1 text-right font-semibold">현재</th>
                                  <th className="px-2 py-1 text-right font-semibold">증감</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.map((it) => {
                                  const c = annual(it.current);
                                  const b0 = annual(it.baseline);
                                  const d = (c ?? 0) - (b0 ?? 0);
                                  return (
                                    <tr key={it.label} className="border-t border-slate-100">
                                      <td className="px-2 py-1 text-slate-700">{it.label}</td>
                                      <td className="px-2 py-1 text-right tabular-nums text-slate-500">{fmtK(b0)}</td>
                                      <td className="px-2 py-1 text-right tabular-nums text-slate-700">{fmtK(c)}</td>
                                      <td className={`px-2 py-1 text-right font-semibold tabular-nums ${diffTone(d)}`}>
                                        {fmtK(d, true)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}

                      <p className="px-2 pb-2 text-[10px] leading-relaxed text-slate-400">
                        축은 전월 대비 증감 (영업이익 = 실판매출 − 원가 − 평가감 − 직접비 − 영업비).
                        막대에 마우스를 올리면 원본 금액과 원가율 변화가 보입니다.
                      </p>
                    </div>
                  </div>
                )}

              </aside>

              <div className="min-w-0">
                {table('② 현재 버전', (r) => r.current, {
                  head: 'bg-sky-600 text-white',
                  ring: 'border-sky-300',
                  th: 'bg-sky-50 text-sky-900',
                })}
              </div>

              <div className="min-w-0">
                {table('③ 전월 버전 (지난달 보고)', (r) => r.baseline, {
                  head: 'bg-slate-500 text-white',
                  ring: 'border-slate-300',
                  th: 'bg-slate-100 text-slate-700',
                })}
              </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
