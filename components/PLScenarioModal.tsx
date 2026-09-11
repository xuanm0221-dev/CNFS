'use client';

// 시나리오 모달 — 손익계산서 탭 "시나리오" 버튼
//   현재 계획(2026.csv)에서 긍정·부정 시나리오를 즉석 계산해 손익계산서 형식으로 보여 준다.
//   상단 탭으로 법인/브랜드를 전환한다. 계산 규칙은 lib/pl-scenario.ts 머리 주석 참고.
import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import PLScenarioPanel, { ScenarioStepper, type ScenarioView } from './PLScenarioPanel';
import type { PLScenarioResponse } from '@/app/api/fs/pl/scenario/route';
import {
  buildScenarios, DEFAULT_SCENARIO_PARAMS, SCENARIO_ROWS,
  type ScenarioKey, type ScenarioParams, type Series,
} from '@/lib/pl-scenario';

const BRAND_LABELS: Record<string, string> = {
  all: '법인', mlb: 'MLB', kids: 'MLB KIDS', discovery: 'DISCOVERY', duvetica: 'DUVETICA', supra: 'SUPRA',
};

/** 시리즈 하나를 표 행 순서대로 JSON 행으로. 비율 행은 월별 num÷den (분모 0 이면 null) */
function toJsonRows(series: Series) {
  return SCENARIO_ROWS.map((r) => {
    const values: (number | null)[] = r.ratio
      ? new Array(12).fill(0).map((_, i) => {
          const den = series[r.ratio!.den]?.[i] ?? 0;
          return den === 0 ? null : (series[r.ratio!.num]?.[i] ?? 0) / den;
        })
      : (series[r.account] ?? new Array(12).fill(0)).map((v) => Math.round(v));
    return {
      account: r.account,
      label: r.label,
      level: r.level,
      format: r.ratio ? 'percent' : 'number',
      ...(r.isBold ? { isBold: true } : {}),
      values,
    };
  });
}

const TABS: { key: string; label: string }[] = [
  { key: 'all', label: '법인' },
  { key: 'mlb', label: 'MLB' },
  { key: 'kids', label: 'MLB KIDS' },
  { key: 'discovery', label: 'DISCOVERY' },
  { key: 'duvetica', label: 'DUVETICA' },
  { key: 'supra', label: 'SUPRA' },
];

interface Props {
  year: number;
  onClose: () => void;
}

export default function PLScenarioModal({ year, onClose }: Props) {
  const [brand, setBrand] = useState<string>('all');
  const [params, setParams] = useState<ScenarioParams>(DEFAULT_SCENARIO_PARAMS);
  /** 표시 단위 — 기본 분기 */
  const [view, setView] = useState<ScenarioView>('quarter');
  const [downloading, setDownloading] = useState(false);

  /**
   * JSON 내려받기 — 법인 + 5개 브랜드 × 부정·기존·긍정 (+2025 실적) 을 한 파일로.
   * 배포본에서도 받을 수 있게 클라이언트에서 계산해 Blob 으로 내린다. 지금 ±%p 설정이 그대로 들어간다.
   */
  const downloadJson = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/fs/pl/scenario?brand=all&year=${year}`, { cache: 'no-store' });
      const json = (await res.json()) as PLScenarioResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? '시나리오 데이터를 불러오지 못했습니다.');

      const keys: ScenarioKey[] = ['negative', 'current', 'positive'];
      const pack = (data: PLScenarioResponse) => {
        const r = buildScenarios(data, params);
        return {
          negative: toJsonRows(r.series.negative),
          current: toJsonRows(r.series.current),
          positive: toJsonRows(r.series.positive),
          prevYear: toJsonRows(r.prev),
          scenarioApplied: r.scenarioBrands.length > 0,
        };
      };
      const brands: Record<string, ReturnType<typeof pack>> = { 법인: pack(json) };
      for (const id of Object.keys(json.brands)) {
        brands[BRAND_LABELS[id] ?? id] = pack({ ...json, brands: { [id]: json.brands[id] } });
      }

      // 대시보드는 한국시간(KST) 기준
      const kstIso = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00');
      const payload = {
        year,
        baseMonth: json.baseMonth,
        params: { 직영YoY_pp: params.directDelta, 대리상ACC_YoY_pp: params.dealerDelta },
        scenarios: keys,
        exportedAt: kstIso,
        unit: 'CNY (원 단위). percent 행은 비율',
        note: '1~기준월은 실적, 기준월+1~12월만 시나리오. values = [1월, …, 12월]. prevYear = 전년 실적. 리테일매출은 출고 Tag 배율을 그대로 따름(직영=Tag직영, 대리상=Tag대리상). DUVETICA·SUPRA 는 시나리오 미적용(세 값 동일).',
        brands,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `시나리오_${year}_브랜드별_${kstIso.slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'JSON 다운로드에 실패했습니다.');
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-[1440px] overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <div>
              <h2 className="text-base font-semibold text-slate-800">시나리오 — {year}년</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                단위 K위안 · 현재 계획(2026.csv)에서 긍정·부정 시나리오를 계산 · 저장하지 않음
              </p>
            </div>
            {/* JSON 내려받기 — 법인 + 브랜드 × 부정·기존·긍정 한 파일 */}
            <button
              type="button"
              onClick={downloadJson}
              disabled={downloading}
              title="법인 + 5개 브랜드 × 부정·기존·긍정 (+2025 실적) 을 JSON 한 파일로. 지금 ±%p 설정 반영"
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition-all hover:border-slate-400 hover:bg-slate-50 hover:shadow disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5 text-slate-500" />
              {downloading ? '생성 중…' : `${year} JSON`}
              <span className="rounded-full bg-slate-100 px-1.5 py-px text-[10px] font-bold tracking-wide text-slate-600 ring-1 ring-inset ring-slate-200">
                부정 · 기존 · 긍정
              </span>
            </button>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 법인 · 브랜드 전환탭 + 우측 ±%p 스텝퍼 */}
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
          <div className="flex flex-wrap items-center gap-3">
            {/* 월 / 분기 / 연간 — 계획월이 든 기간만 보여 준다 */}
            <div className="inline-flex items-center gap-0.5 rounded-lg border border-slate-300 bg-white p-0.5">
              {([['month', '월'], ['quarter', '분기'], ['year', '연간']] as [ScenarioView, string][]).map(([k, lab]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setView(k)}
                  className={`rounded-md px-2.5 py-0.5 text-xs font-semibold transition-colors ${
                    view === k ? 'bg-[#34506F] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {lab}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
              <ScenarioStepper label="직영 YoY ±" value={params.directDelta} onChange={(v) => setParams((p) => ({ ...p, directDelta: v }))} />
              <ScenarioStepper label="대리상 ACC YoY ±" value={params.dealerDelta} onChange={(v) => setParams((p) => ({ ...p, dealerDelta: v }))} />
            </div>
          </div>
        </div>

        <div className="max-h-[calc(90vh-110px)] overflow-auto p-5">
          <PLScenarioPanel brand={brand} year={year} params={params} view={view} />
        </div>
      </div>
    </div>
  );
}
