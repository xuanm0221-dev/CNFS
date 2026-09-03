'use client';

// 지난달 보고 대비 — 현재 버전(2026.csv) vs 전월 버전(2026_기존.csv, 지난달 보고본)
//   표 3개를 분리해서 세로로 쌓는다 — ① 현재버전 ② 전월대비(현재 − 전월) ③ 전월버전
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
    () => new Set(['Tag매출', '실판매출']),
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const allRows = data?.rows ?? [];
  // 접힌 부모(Tag매출/실판매출)의 채널 행은 숨긴다
  const rows = (() => {
    const out: typeof allRows = [];
    let hideUnderLevel = -1;
    for (const r of allRows) {
      if (hideUnderLevel >= 0 && r.level > hideUnderLevel) continue;
      hideUnderLevel = -1;
      out.push(r);
      if (r.isChannelParent && collapsed.has(r.account)) hideUnderLevel = r.level;
    }
    return out;
  })();
  const changed = data?.baselineBrands ?? [];
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
            {QUARTERS.map((q) => (
              <th key={q} className={`border border-slate-200 px-3 py-1.5 text-right text-xs font-semibold ${tone.th}`}>
                {q}
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
            const isGroupRow = r.isChannelParent === true;
            // 펼친 채널 행은 배경·글씨를 달리해 상위 계정과 구분한다
            const childTone = r.isReference ? 'bg-slate-100/80 text-[11px] italic text-slate-500' : '';
            return (
              <tr key={`${title}-${r.account}`} className={r.isReference ? '' : 'hover:bg-sky-50/40'}>
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
                {q.map((val, i) => (
                  <td
                    key={i}
                    className={`border border-slate-200 px-3 py-1.5 text-right tabular-nums ${childTone} ${
                      diff ? diffTone(val) : r.isReference ? '' : val != null && val < 0 ? 'text-rose-600' : 'text-slate-800'
                    } ${isBold ? 'font-semibold' : ''}`}
                  >
                    {fmtK(val, diff)}
                  </td>
                ))}
                <td
                  className={`border border-slate-200 px-3 py-1.5 text-right font-semibold tabular-nums ${childTone || 'bg-slate-50/60'} ${
                    diff ? diffTone(a) : r.isReference ? '' : a != null && a < 0 ? 'text-rose-600' : 'text-slate-800'
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
        className="max-h-[90vh] w-full max-w-[1000px] overflow-hidden rounded-lg bg-white shadow-xl"
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
        <div className="border-b border-slate-200 px-5 py-2.5">
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
              <div className="space-y-5">
                {table('① 현재 버전', (r) => r.current, {
                  head: 'bg-sky-600 text-white',
                  ring: 'border-sky-300',
                  th: 'bg-sky-50 text-sky-900',
                })}
                {table(
                  '② 전월대비 (현재 − 전월)',
                  (r) => r.current.map((v, i) => {
                    const b = r.baseline[i];
                    if (v == null && b == null) return null;
                    return (v ?? 0) - (b ?? 0);
                  }),
                  { head: 'bg-amber-500 text-white', ring: 'border-amber-300', th: 'bg-amber-50 text-amber-900' },
                  true,
                )}
                {table('③ 전월 버전 (지난달 보고)', (r) => r.baseline, {
                  head: 'bg-slate-500 text-white',
                  ring: 'border-slate-300',
                  th: 'bg-slate-100 text-slate-700',
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
