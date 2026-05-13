'use client';

import { useEffect, useState } from 'react';
import { MONTH_HEADERS } from './pl-forecast/plForecastConfig';

interface TagRecoveryRateRow {
  category: string;
  season: string;
  monthly: (number | null)[];
}

interface ApiResponse {
  rows?: TagRecoveryRateRow[];
  error?: string;
}

function formatRate(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '';
  return `${Math.round(v * 100)}%`;
}

export default function TagRecoveryRateTable() {
  const [rows, setRows] = useState<TagRecoveryRateRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    fetch('/api/pl-forecast/tag-recovery-rate', { cache: 'no-store' })
      .then((r) => r.json())
      .then((json: ApiResponse) => {
        if (!mounted) return;
        if (json.error) {
          setError(json.error);
          return;
        }
        setRows(json.rows ?? []);
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
        Tag대비회수율 로딩 중...
      </div>
    );
  }
  if (error) {
    return (
      <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Tag대비회수율 로딩 실패: {error}
      </div>
    );
  }

  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-sm">
      <div className="border-b border-slate-200 bg-slate-50/60 px-4 py-2">
        <div className="font-semibold text-slate-800">Tag대비 회수율</div>
        <div className="mt-0.5 text-xs text-slate-500">가정: Tag대비원가율 35%, Tag 100, 원가 31</div>
      </div>
      <div className="overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-[120px] border-b border-r border-slate-200 bg-navy px-3 py-2 text-center font-semibold text-white">
                구분
              </th>
              <th className="min-w-[90px] border-b border-r border-slate-200 bg-navy px-3 py-2 text-center font-semibold text-white">
                시즌
              </th>
              {MONTH_HEADERS.map((label) => (
                <th
                  key={`tag-rec-h-${label}`}
                  className="min-w-[90px] border-b border-r border-slate-200 bg-navy px-3 py-2 text-center font-semibold text-white"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={`tag-rec-r-${ri}`} className="bg-white">
                <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-inherit px-3 py-2 font-medium text-slate-800">
                  {r.category}
                </td>
                <td className="border-b border-r border-slate-200 bg-inherit px-3 py-2 text-slate-700">
                  {r.season}
                </td>
                {r.monthly.map((v, mi) => (
                  <td
                    key={`tag-rec-c-${ri}-${mi}`}
                    className="border-b border-r border-slate-200 px-3 py-2 text-right"
                  >
                    {formatRate(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
