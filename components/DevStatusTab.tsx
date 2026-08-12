'use client';

import { useCallback, useEffect, useState } from 'react';

type Category = '전처리' | '저장' | '자동' | 'CSV';

interface StatusItem {
  category: Category;
  label: string;
  files: string[];
  how?: string;
  marker?: string | null;
  markerValue?: string | number | null;
  mixed?: boolean;
  savedAt?: string | null;
  mtime?: string | null;
  exists: boolean;
  dirty?: boolean;
}

interface StatusResponse {
  items: StatusItem[];
  gitAvailable: boolean;
  checkedAt: string;
  error?: string;
}

/** UTC ISO → KST 표기 */
function toKst(iso?: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

function daysAgo(iso?: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
}

/** 기준월과 파일 마커 비교 → 전처리를 다시 돌려야 하는지 */
function markerVerdict(item: StatusItem, baseMonth: number): { ok: boolean; text: string } | null {
  if (item.markerValue == null) return null;
  const v = String(item.markerValue);
  if (item.mixed) return { ok: false, text: `${v} (파일마다 다름)` };
  if (item.marker === 'closedThrough') {
    const expected = `2026${String(baseMonth).padStart(2, '0')}`;
    return { ok: v === expected, text: v };
  }
  if (item.marker === 'throughMonth' || item.marker === 'baseMonth') {
    return { ok: Number(v) === baseMonth, text: `${v}월` };
  }
  return { ok: true, text: v };
}

const CATEGORY_DESC: Record<Category, string> = {
  전처리: 'Snowflake → 파일. 결산월이 바뀌면 스크립트를 다시 돌려야 합니다.',
  저장: '대시보드에서 저장 버튼을 눌러야 갱신됩니다.',
  자동: '재고자산(sim) 탭을 열면 자동 저장됩니다. 커밋은 필요합니다.',
  CSV: '직접 편집하는 원본 파일입니다.',
};

const CATEGORY_ORDER: Category[] = ['전처리', '저장', '자동', 'CSV'];

export default function DevStatusTab({ baseMonth = 7 }: { baseMonth?: number }) {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/dev/status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((json: StatusResponse) => {
        if (json.error) setError(json.error);
        else setData(json);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const items = data?.items ?? [];
  const stale = items.filter((i) => {
    const v = markerVerdict(i, baseMonth);
    return v != null && !v.ok;
  });
  const uncommitted = items.filter((i) => i.dirty);

  return (
    <div className="px-[1.5%] py-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold text-slate-900">배포 준비 상태</h2>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
          기준월 {baseMonth}월
        </span>
        <span className="rounded-md bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">dev 전용</span>
        <button
          type="button"
          onClick={load}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 shadow-sm hover:bg-slate-50"
        >
          새로고침
        </button>
        {data?.checkedAt && (
          <span className="text-xs text-slate-400">조회 {toKst(data.checkedAt)} KST</span>
        )}
      </div>

      {/* 요약 */}
      {!loading && !error && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className={`rounded-xl border px-4 py-3 ${stale.length ? 'border-rose-300 bg-rose-50' : 'border-emerald-300 bg-emerald-50'}`}>
            <div className={`text-sm font-bold ${stale.length ? 'text-rose-800' : 'text-emerald-800'}`}>
              {stale.length ? `전처리 ${stale.length}건 다시 돌려야 함` : '전처리 전부 최신'}
            </div>
            {stale.length > 0 && (
              <div className="mt-1 text-xs text-rose-700">{stale.map((s) => s.label).join(', ')}</div>
            )}
          </div>
          <div className={`rounded-xl border px-4 py-3 ${uncommitted.length ? 'border-amber-300 bg-amber-50' : 'border-emerald-300 bg-emerald-50'}`}>
            <div className={`text-sm font-bold ${uncommitted.length ? 'text-amber-800' : 'text-emerald-800'}`}>
              {data?.gitAvailable === false
                ? 'git 상태를 읽을 수 없음'
                : uncommitted.length
                  ? `미커밋 ${uncommitted.length}건 — 푸시해야 배포본에 반영됩니다`
                  : '미커밋 없음'}
            </div>
            {uncommitted.length > 0 && (
              <div className="mt-1 text-xs text-amber-700">{uncommitted.map((s) => s.label).join(', ')}</div>
            )}
          </div>
        </div>
      )}

      {loading && <div className="py-10 text-center text-sm text-slate-400">불러오는 중…</div>}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {!loading && !error && CATEGORY_ORDER.map((cat) => {
        const rows = items.filter((i) => i.category === cat);
        if (rows.length === 0) return null;
        return (
          <div key={cat} className="mb-5">
            <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-bold text-slate-800">{cat}</span>
              <span className="text-xs text-slate-500">{CATEGORY_DESC[cat]}</span>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-700">
                    <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold">항목</th>
                    <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold">기준</th>
                    <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold">저장/생성 시각 (KST)</th>
                    <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold">커밋</th>
                    <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold">실행 방법 / 파일</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((i) => {
                    const v = markerVerdict(i, baseMonth);
                    const when = i.savedAt ?? i.mtime;
                    const ago = daysAgo(when);
                    return (
                      <tr key={i.files[0]} className={!i.exists ? 'bg-rose-50' : v && !v.ok ? 'bg-rose-50' : 'bg-white'}>
                        <td className="border-b border-slate-100 px-3 py-1.5 font-medium text-slate-800 whitespace-nowrap">{i.label}</td>
                        <td className="border-b border-slate-100 px-3 py-1.5 whitespace-nowrap">
                          {!i.exists ? (
                            <span className="font-semibold text-rose-700">파일 없음</span>
                          ) : v ? (
                            <span className={v.ok ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-700'}>
                              {v.ok ? '🟢' : '🔴'} {v.text}
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-1.5 tabular-nums whitespace-nowrap">
                          {toKst(when)}
                          {ago != null && ago > 0 && <span className="ml-1 text-slate-400">({ago}일 전)</span>}
                          {i.savedAt == null && i.exists && <span className="ml-1 text-slate-400">(파일시각)</span>}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-1.5 whitespace-nowrap">
                          {i.dirty == null ? (
                            <span className="text-slate-300">-</span>
                          ) : i.dirty ? (
                            <span className="font-semibold text-amber-700">⚠️ 미커밋</span>
                          ) : (
                            <span className="text-emerald-700">✓</span>
                          )}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-1.5 text-slate-500">
                          {i.how && (
                            <div className="font-mono text-[11px] text-slate-700">
                              {i.how.replace('{M}', String(baseMonth))}
                            </div>
                          )}
                          <div className="text-[11px] text-slate-400">
                            {i.files.length > 1
                              ? `${i.files[0].replace(/[^/]+$/, '')} · ${i.files.length}개 파일`
                              : i.files[0]}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
