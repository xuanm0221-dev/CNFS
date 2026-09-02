'use client';

// 전월대비 — 현재 버전(2026.csv) vs 전월 버전(2026_기존.csv, 지난달 보고본)
//   상단 = 현재버전 · 중단 = 전월버전 · 하단 = 전월대비(현재 − 전월)
//   상단 탭으로 법인/브랜드를 전환한다.
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import type { PLCompareResponse } from '@/app/api/fs/pl/compare/route';

const QUARTERS = ['1Q', '2Q', '3Q', '4Q'];

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
  // 채널별 보기는 기본 접힘 — 손익계산서와 동일
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(['Tag매출_채널보기', '실판매출_채널보기']),
  );
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
        if (!res.ok) throw new Error(json?.error ?? '전월대비 데이터를 불러오지 못했습니다.');
        setData(json);
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : '전월대비 데이터를 불러오지 못했습니다.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [brand, year]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const allRows = data?.rows ?? [];
  // 접힌 '채널별 보기' 그룹의 하위(level 2)는 숨긴다
  const rows = (() => {
    const out: typeof allRows = [];
    let hideUnderLevel = -1;
    for (const r of allRows) {
      if (hideUnderLevel >= 0 && r.level > hideUnderLevel) continue;
      hideUnderLevel = -1;
      out.push(r);
      if (r.isReference && r.level === 1 && collapsed.has(r.account)) hideUnderLevel = r.level;
    }
    return out;
  })();
  const changed = data?.baselineBrands ?? [];
  const brandChanged = brand === 'all' ? changed.length > 0 : changed.includes(brand);

  /** 한 블록(현재/전월/전월대비) 렌더 */
  const block = (
    title: string,
    pick: (r: PLCompareResponse['rows'][number]) => (number | null)[],
    opts?: { diff?: boolean; tone?: string },
  ) => (
    <>
      <tr>
        <td
          colSpan={6}
          className={`border border-slate-200 px-3 py-1.5 text-xs font-semibold ${opts?.tone ?? 'bg-slate-100 text-slate-700'}`}
        >
          {title}
        </td>
      </tr>
      {rows.map((r) => {
        const v = pick(r);
        const q = toQuarters(v);
        const a = annual(v);
        const isBold = r.account === '영업이익(관리식)' || r.account === '매출총이익';
        // 채널별 보기 = 참고 기준. 손익계산서와 같은 보라 톤 2단계로 구분한다.
        const isGroupRow = r.isReference === true && r.level === 1;
        const refTone = !r.isReference
          ? ''
          : r.level === 1
            ? 'bg-violet-100 text-violet-900 italic'
            : 'bg-violet-50/50 text-violet-700 italic';
        return (
          <tr key={`${title}-${r.account}`} className={r.isReference ? '' : 'hover:bg-sky-50/40'}>
            <td
              className={`border border-slate-200 py-1.5 pr-3 ${refTone} ${isGroupRow ? 'cursor-pointer' : ''} ${isBold ? 'font-semibold text-slate-800' : r.isReference ? '' : 'text-slate-700'}`}
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
            {q.map((val, i) => (
              <td
                key={i}
                className={`border border-slate-200 px-3 py-1.5 text-right tabular-nums ${refTone} ${
                  opts?.diff ? diffTone(val) : r.isReference ? '' : val != null && val < 0 ? 'text-rose-600' : 'text-slate-800'
                } ${isBold ? 'font-semibold' : ''}`}
              >
                {fmtK(val, opts?.diff)}
              </td>
            ))}
            <td
              className={`border border-slate-200 px-3 py-1.5 text-right font-semibold tabular-nums ${refTone || 'bg-slate-50/60'} ${
                opts?.diff ? diffTone(a) : r.isReference ? '' : a != null && a < 0 ? 'text-rose-600' : 'text-slate-800'
              }`}
            >
              {fmtK(a, opts?.diff)}
            </td>
          </tr>
        );
      })}
    </>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-[1000px] overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">전월대비 — {year}년</h2>
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

        {/* 법인 · 브랜드 전환탭 */}
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 px-5 py-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setBrand(t.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                brand === t.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              {t.label}
            </button>
          ))}
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
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="w-[180px] border border-slate-200 bg-slate-800 px-3 py-2 text-left font-semibold text-white">
                      계정과목
                    </th>
                    {QUARTERS.map((q) => (
                      <th key={q} className="border border-slate-200 bg-slate-800 px-3 py-2 text-right font-semibold text-white">
                        {q}
                      </th>
                    ))}
                    <th className="border border-slate-200 bg-slate-800 px-3 py-2 text-right font-semibold text-white">
                      연간
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {block('현재 버전', (r) => r.current, { tone: 'bg-sky-50 text-sky-800' })}
                  {block('전월 버전 (지난달 보고)', (r) => r.baseline, { tone: 'bg-slate-100 text-slate-600' })}
                  {block(
                    '전월대비 (현재 − 전월)',
                    (r) => r.current.map((v, i) => {
                      const b = r.baseline[i];
                      if (v == null && b == null) return null;
                      return (v ?? 0) - (b ?? 0);
                    }),
                    { diff: true, tone: 'bg-amber-50 text-amber-800' },
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
