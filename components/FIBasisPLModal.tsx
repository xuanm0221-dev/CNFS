'use client';

// FI기준 손익표 — 파일/재무조정/FI기준손익.csv 를 분기별 표로 보여주는 모달.
//   매출은 브랜드 5개 합계(하위 브랜드 행 전개), 매출원가·평가감·판관비는 파일 값 그대로
//   (재무식이라 브랜드 구분 불가).
//   매출총이익 = 매출 − 매출원가 − 평가감,  영업이익 = 매출총이익 − 판관비
//   2026년은 같은 셀에 전년(2025) 동일분기 대비 증감액·증감률을 함께 표시한다.
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

import type { FIPLResponse, FIYearData } from '@/app/api/fs/pl/fi/route';

const BRANDS = ['MLB', 'MLB KIDS', 'DISCOVERY', 'DUVETICA', 'SUPRA'];
const QUARTERS = ['1분기', '2분기', '3분기', '4분기'];

type RowKind = 'group' | 'child' | 'file' | 'calc';
interface FIRow {
  label: string;
  kind: RowKind;
  values: (number | null)[];
}

// 분기별 합산 — 전부 null 이면 null (미결산 분기는 '-' 로 남긴다)
function sumQuarters(list: (number | null)[][]): (number | null)[] {
  return QUARTERS.map((_, q) => {
    let sum = 0;
    let has = false;
    for (const arr of list) {
      const v = arr?.[q];
      if (v !== null && v !== undefined && !Number.isNaN(v)) { sum += v; has = true; }
    }
    return has ? sum : null;
  });
}

function combine(
  parts: { values: (number | null)[]; sign: 1 | -1 }[],
): (number | null)[] {
  return QUARTERS.map((_, q) => {
    let sum = 0;
    let has = false;
    for (const p of parts) {
      const v = p.values[q];
      if (v === null || v === undefined || Number.isNaN(v)) continue;
      sum += p.sign * v;
      has = true;
    }
    return has ? sum : null;
  });
}

function buildRows(year: FIYearData): FIRow[] {
  const brandRows = BRANDS.map(b => ({
    label: b,
    kind: 'child' as const,
    values: year.매출[b] ?? [null, null, null, null],
  }));
  const 매출 = sumQuarters(brandRows.map(r => r.values));
  const 매출총이익 = combine([
    { values: 매출, sign: 1 },
    { values: year.매출원가, sign: -1 },
    { values: year.평가감, sign: -1 },
  ]);
  const 영업이익 = combine([
    { values: 매출총이익, sign: 1 },
    { values: year.판관비, sign: -1 },
  ]);

  return [
    { label: '매출', kind: 'group', values: 매출 },
    ...brandRows,
    { label: '매출원가', kind: 'file', values: year.매출원가 },
    { label: '평가감', kind: 'file', values: year.평가감 },
    { label: '매출총이익', kind: 'calc', values: 매출총이익 },
    { label: '판관비', kind: 'file', values: year.판관비 },
    { label: '영업이익', kind: 'calc', values: 영업이익 },
  ];
}

type Unit = 'k' | 'one';
type Currency = 'CNY' | 'KRW';

const UNIT_LABELS: Record<Currency, Record<Unit, string>> = {
  CNY: { k: '천위안', one: '1위안' },
  KRW: { k: '천원', one: '1원' },
};

/**
 * CNY 분기 시리즈 → KRW 분기 시리즈.
 * 환율은 분기 누적평균만 존재한다 (2025 2분기 = 1~6월 평균).
 *   누적KRW(Q) = 누적CNY(Q) × 환율(Q)
 *   당분기KRW(Q) = 누적KRW(Q) − 누적KRW(Q−1)
 */
function toKRW(cny: (number | null)[], rates: (number | null)[] | undefined): (number | null)[] {
  if (!rates) return [null, null, null, null];
  let cumCNY = 0;
  let cumKRW = 0;
  return cny.map((v, q) => {
    const rate = rates[q];
    if (v === null || v === undefined || Number.isNaN(v) || rate === null || rate === undefined) return null;
    cumCNY += v;
    const nextCumKRW = cumCNY * rate;
    const quarterKRW = nextCumKRW - cumKRW;
    cumKRW = nextCumKRW;
    return quarterKRW;
  });
}

// 천 단위(÷1000) / 1 단위 전환. 음수는 대시보드 표기 규칙대로 △.
function formatValue(value: number | null, unit: Unit, showSign = false): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const scaled = unit === 'k' ? value / 1000 : value;
  const formatted = new Intl.NumberFormat('ko-KR').format(Math.abs(Math.round(scaled)));
  if (value < 0) return '△' + formatted;
  return showSign && value > 0 ? '+' + formatted : formatted;
}

interface Props {
  year: number;
  onClose: () => void;
}

export default function FIBasisPLModal({ year, onClose }: Props) {
  const [currency, setCurrency] = useState<Currency>('CNY');
  const [unit, setUnit] = useState<Unit>('k');
  const [payload, setPayload] = useState<FIPLResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch('/api/fs/pl/fi', { cache: 'no-store' });
        const json = await res.json();
        if (!mounted) return;
        if (!res.ok) throw new Error(json?.error ?? 'FI기준 손익 데이터를 불러오지 못했습니다.');
        setPayload(json);
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : 'FI기준 손익 데이터를 불러오지 못했습니다.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const yearData = payload?.data?.[String(year)];
  const prevData = payload?.data?.[String(year - 1)];
  // KRW 전환은 행 단위로 적용해도 합계 관계가 유지된다 (분기 누적 환산이 선형이라 Σ자식 = 부모).
  const convert = (list: FIRow[], y: number): FIRow[] =>
    currency === 'CNY' ? list : list.map(r => ({ ...r, values: toKRW(r.values, payload?.rates?.[String(y)]) }));
  const rows = yearData ? convert(buildRows(yearData), year) : [];
  const prevRows = prevData ? convert(buildRows(prevData), year - 1) : null;
  // 전년비는 전년 데이터가 있을 때만 (2025 탭은 2024 데이터가 파일에 없어 자동으로 숨겨진다)
  const showYoY = prevRows !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-[1100px] overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">FI기준 손익표 — {year}년</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              파일/재무조정/FI기준손익.csv
              {currency === 'KRW' && ` · 분기 누적평균환율 ${(payload?.rates?.[String(year)] ?? []).map(r => r ?? '-').join(' / ')} 로 누적 환산 후 전분기 차감`}
              {showYoY && ' · 하단 작은 값은 전년 동일분기 대비 증감액 / 증감률'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* 통화 전환 — CNY / KRW (KRW는 분기 누적평균환율로 환산) */}
            <div className="inline-flex overflow-hidden rounded-md border border-slate-200">
              {(['CNY', 'KRW'] as Currency[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setCurrency(key)}
                  className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                    currency === key
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-white text-slate-500 hover:bg-slate-50'
                  } ${key === 'KRW' ? 'border-l border-slate-200' : ''}`}
                >
                  {key}
                </button>
              ))}
            </div>
            {/* 단위 전환 — 천 단위 / 1 단위 */}
            <div className="inline-flex overflow-hidden rounded-md border border-slate-200">
              {(['k', 'one'] as Unit[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setUnit(key)}
                  className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                    unit === key
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'bg-white text-slate-500 hover:bg-slate-50'
                  } ${key === 'one' ? 'border-l border-slate-200' : ''}`}
                >
                  {UNIT_LABELS[currency][key]}
                </button>
              ))}
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              aria-label="닫기"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="max-h-[calc(88vh-64px)] overflow-auto p-5">
          {loading && <p className="py-10 text-center text-sm text-slate-500">불러오는 중…</p>}
          {error && <p className="py-10 text-center text-sm text-rose-600">{error}</p>}
          {!loading && !error && !yearData && (
            <p className="py-10 text-center text-sm text-slate-500">{year}년 데이터가 FI기준손익.csv에 없습니다.</p>
          )}

          {!loading && !error && yearData && (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 w-[180px] border border-slate-200 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-700">
                    계정
                  </th>
                  {QUARTERS.map(q => (
                    <th key={q} className="border border-slate-200 bg-slate-100 px-3 py-2 text-right font-semibold text-slate-700">
                      {q}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => {
                  const isBold = row.kind === 'group' || row.kind === 'calc';
                  const bg =
                    row.kind === 'calc' ? 'bg-highlight-yellow'
                      : row.kind === 'group' ? 'bg-highlight-mint'
                        : row.kind === 'child' ? 'bg-white' : 'bg-slate-50';
                  return (
                    <tr key={row.label} className="hover:bg-sky-50/40">
                      <td
                        className={`sticky left-0 z-10 border border-slate-200 px-3 py-2 ${bg} ${isBold ? 'font-semibold text-slate-800' : 'text-slate-700'}`}
                        style={{ paddingLeft: row.kind === 'child' ? '28px' : '12px' }}
                      >
                        {row.label}
                      </td>
                      {QUARTERS.map((q, qi) => {
                        const v = row.values[qi];
                        const prev = prevRows?.[ri]?.values[qi] ?? null;
                        const diff = v !== null && prev !== null ? v - prev : null;
                        const rate = diff !== null && prev !== null && prev !== 0 ? (diff / Math.abs(prev)) * 100 : null;
                        return (
                          <td
                            key={q}
                            className={`border border-slate-200 px-3 py-2 text-right tabular-nums ${bg} ${isBold ? 'font-semibold' : ''} ${v !== null && v < 0 ? 'text-rose-600' : 'text-slate-800'}`}
                          >
                            <div>{formatValue(v, unit)}</div>
                            {showYoY && (
                              <div className={`mt-0.5 text-[11px] font-normal ${diff === null ? 'text-slate-300' : diff >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                {diff === null
                                  ? '-'
                                  : `${formatValue(diff, unit, true)}${rate === null ? '' : ` (${rate >= 0 ? '+' : ''}${rate.toFixed(1)}%)`}`}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
