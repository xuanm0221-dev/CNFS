'use client';

/**
 * 사업계획 — 첫 화면 (브랜드 카드).
 * 브랜드 카드 → 손익계산서 이동. (초기 설계는 CNPL 정적 페이지를 참고했고 현재는 이 컴포넌트가 원본)
 * 카드 지표는 재무제표 대시보드와 같은 PL API 에서 뽑으므로 별도 계산이 없다.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  BP_BRANDS,
  PlRow,
  YEAR,
  annualSum,
  fmtK,
  fmtRate,
  plUrl,
} from './shared';

interface Kpi {
  tag: number | null;
  net: number | null;
  gp: number | null;
  op: number | null;
  /** 리테일매출 + 하위 2개 (대리상/직영) */
  retail: number | null;
  retailDealer: number | null;
  retailDirect: number | null;
  retailPrev: number | null;
  retailDealerPrev: number | null;
  retailDirectPrev: number | null;
  /** Tag매출 하위 4개 (대리상/직영 × 의류/ACC) */
  tagDealerApp: number | null;
  tagDealerAcc: number | null;
  tagDirectApp: number | null;
  tagDirectAcc: number | null;
  /** 전년 연간 — comparisons.prevYearAnnual */
  tagPrev: number | null;
  netPrev: number | null;
  opPrev: number | null;
  tagDealerAppPrev: number | null;
  tagDealerAccPrev: number | null;
  tagDirectAppPrev: number | null;
  tagDirectAccPrev: number | null;
}

/** YoY 배수(%) — 당년 ÷ 전년. 소수점 없이 표기 */
function fmtYoy(cur: number | null | undefined, prev: number | null | undefined): string {
  if (cur == null || !prev) return '';
  return ` (${Math.round((cur / prev) * 100)}%)`;
}

/** 증감액 — 부호 포함 K위안 */
function fmtDelta(cur: number | null | undefined, prev: number | null | undefined): string {
  if (cur == null || prev == null) return '–';
  const d = Math.round((cur - prev) / 1000);
  return `${d >= 0 ? '+' : ''}${d.toLocaleString('ko-KR')}`;
}

/** 이익률 증감 (%p) */
function fmtPp(
  cur: number | null | undefined, curBase: number | null | undefined,
  prev: number | null | undefined, prevBase: number | null | undefined,
): string {
  if (cur == null || !curBase || prev == null || !prevBase) return '–';
  const d = (cur / curBase - prev / prevBase) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%p`;
}

/** YoY 색 — 전년비 100% 이상 초록, 미만 빨강 */
function yoyTone(cur: number | null | undefined, prev: number | null | undefined): string {
  if (cur == null || !prev) return 'text-[#6A7686]';
  return cur / prev >= 1 ? 'text-[#176B43]' : 'text-[#A93B33]';
}

const tone = (t: string) => (t.startsWith('+') ? 'text-[#176B43]' : t.startsWith('-') ? 'text-[#A93B33]' : 'text-[#6A7686]');

export default function BusinessPlanHub({ baseMonth }: { baseMonth: number }) {
  const bm = baseMonth; // 재무제표 대시보드 기준월을 그대로 따른다
  const [kpi, setKpi] = useState<Record<string, Kpi>>({});
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    const collected: Record<string, Kpi> = {};
    const failures: string[] = [];

    await Promise.all(
      BP_BRANDS.map(async (b) => {
        try {
          const r = await fetch(plUrl(b.key, YEAR, bm), { cache: 'no-store' });
          if (!r.ok) throw new Error(`${b.label} HTTP ${r.status}`);
          const json: { rows?: PlRow[] } = await r.json();
          const by = new Map((json.rows ?? []).map((row) => [row.account, row]));
          const prev = (a: string) => by.get(a)?.comparisons?.prevYearAnnual ?? null;
          collected[b.key] = {
            retail: annualSum(by.get('리테일매출')),
            retailDealer: annualSum(by.get('리테일_대리상')),
            retailDirect: annualSum(by.get('리테일_직영')),
            retailPrev: prev('리테일매출'),
            retailDealerPrev: prev('리테일_대리상'),
            retailDirectPrev: prev('리테일_직영'),
            tag: annualSum(by.get('Tag매출')),
            net: annualSum(by.get('실판매출')),
            gp: annualSum(by.get('매출총이익')),
            op: annualSum(by.get('영업이익(관리식)')),
            tagDealerApp: annualSum(by.get('대리상_의류')),
            tagDealerAcc: annualSum(by.get('대리상_ACC')),
            tagDirectApp: annualSum(by.get('직영_의류')),
            tagDirectAcc: annualSum(by.get('직영_ACC')),
            tagPrev: prev('Tag매출'),
            netPrev: prev('실판매출'),
            opPrev: prev('영업이익(관리식)'),
            tagDealerAppPrev: prev('대리상_의류'),
            tagDealerAccPrev: prev('대리상_ACC'),
            tagDirectAppPrev: prev('직영_의류'),
            tagDirectAccPrev: prev('직영_ACC'),
          };
        } catch (e) {
          failures.push(e instanceof Error ? e.message : String(e));
        }
      }),
    );

    setKpi(collected);
    setErrors(failures);
    setLoading(false);
  }, [bm]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  return (
    <div className="min-h-screen bg-[#EEF1F4] text-[13px] text-[#1A1A1A]">
      <div className="mx-auto max-w-[1400px] px-6 pb-20 pt-5">
        {/* 헤더 */}
        <div className="border-t-[3px] border-[#15243B] pt-4">
          <div className="text-[11px] tracking-wide text-[#6A7686]">F&amp;F CHINA · 경영관리</div>
          <div className="mt-1 flex flex-wrap items-end gap-3">
            <h1 className="text-[26px] font-bold leading-tight text-[#15243B]">{YEAR} 연간손익</h1>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 border-b border-[#9C7A43] pb-3 text-xs text-[#6A7686]">
            <span>좌측 바에서 브랜드를 선택하세요 · 단위 K위안 · 매출은 실판V−</span>
            <span className="border border-[#C9D2DC] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#34506F]">
              기준월 {bm}월
            </span>
          </div>
        </div>

        {errors.length > 0 && (
          <div className="mb-4 border border-[#A93B33] bg-[#fff5f4] px-4 py-3 text-xs text-[#A93B33]">
            일부 브랜드를 불러오지 못했습니다 — {errors.join(' · ')}
          </div>
        )}

        {/* 카드 */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {BP_BRANDS.map((b) => {
            const k = kpi[b.key];
            return (
              <div
                key={b.key}
                className={`flex flex-col p-5 ${
                  b.primary
                    ? 'border-2 border-[#15243B] bg-[#f7f9fc]'
                    : 'border border-[#C9D2DC] bg-white'
                }`}
              >
                <div className="text-[20px] font-bold" style={{ color: b.color }}>
                  {b.label}
                </div>

                <div className="mt-3 flex-1">
                  <Kv
                    label="리테일매출"
                    value={loading ? '불러오는 중…' : fmtK(k?.retail)}
                    loading={loading}
                    cur={k?.retail ?? null}
                    prev={k?.retailPrev ?? null}
                  />
                  {!loading && (
                    <>
                      <SubKv label="ㄴ 대리상" cur={k?.retailDealer} prev={k?.retailDealerPrev} />
                      <SubKv label="ㄴ 직영" cur={k?.retailDirect} prev={k?.retailDirectPrev} />
                    </>
                  )}
                  <Kv
                    label="Tag매출"
                    value={loading ? '–' : fmtK(k?.tag)}
                    cur={k?.tag ?? null}
                    prev={k?.tagPrev ?? null}
                  />
                  {!loading && (
                    <>
                      <SubKv label="ㄴ 대리상 (APP)" cur={k?.tagDealerApp} prev={k?.tagDealerAppPrev} />
                      <SubKv label="ㄴ 대리상 (ACC)" cur={k?.tagDealerAcc} prev={k?.tagDealerAccPrev} />
                      <SubKv label="ㄴ 직영 (APP)" cur={k?.tagDirectApp} prev={k?.tagDirectAppPrev} />
                      <SubKv label="ㄴ 직영 (ACC)" cur={k?.tagDirectAcc} prev={k?.tagDirectAccPrev} />
                    </>
                  )}
                  <Kv
                    label="실판매출(V−)"
                    value={loading ? '–' : `${fmtK(k?.net)}${fmtYoy(k?.net, k?.netPrev)}`}
                  />
                  <Kv
                    label="매출총이익 (률)"
                    value={loading ? '–' : `${fmtK(k?.gp)}${fmtRate(k?.gp, k?.net) === '–' ? '' : ` (${fmtRate(k?.gp, k?.net)})`}`}
                  />
                  <Kv
                    label="영업이익 (률)"
                    value={loading ? '–' : `${fmtK(k?.op)}${fmtRate(k?.op, k?.net) === '–' ? '' : ` (${fmtRate(k?.op, k?.net)})`}`}
                  />
                  {!loading && (
                    <div className="flex items-baseline justify-between gap-2 pl-3 pt-1.5 text-[11px] text-[#6A7686]">
                      <span>
                        ㄴ 전년 {fmtK(k?.opPrev)}
                        {fmtRate(k?.opPrev, k?.netPrev) === '–' ? '' : ` (${fmtRate(k?.opPrev, k?.netPrev)})`}
                      </span>
                      <span className="tabular-nums">
                        <span className={tone(fmtDelta(k?.op, k?.opPrev))}>{fmtDelta(k?.op, k?.opPrev)}</span>
                        <span className="mx-1 text-[#C9D2DC]">·</span>
                        <span className={tone(fmtPp(k?.op, k?.net, k?.opPrev, k?.netPrev))}>
                          {fmtPp(k?.op, k?.net, k?.opPrev, k?.netPrev)}
                        </span>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 text-[11px] leading-7 text-[#6A7686]">
          · 카드 숫자는 <b>연간 합계</b>(1~12월 합) · Tag·실판 옆 %는 전년 대비 YoY · 이익 옆 %는 실판매출 대비 이익률
          <br />· 기준월({bm}월) 이하는 실적, 이후는 계획
          <br />· 데이터는 재무제표 대시보드와 동일한 PL API 를 사용합니다
        </div>
      </div>
    </div>
  );
}

/** Tag매출 하위 한 줄 — 들여쓰기, 점선 없음 */
function SubKv({ label, cur, prev }: { label: string; cur?: number | null; prev?: number | null }) {
  return (
    <div className="flex items-baseline justify-between gap-2 pl-3 py-[3px] text-[11px] text-[#6A7686]">
      <span className="shrink-0">{label}</span>
      <span className="truncate text-right tabular-nums">
        {fmtK(cur)}
        <span className={yoyTone(cur, prev)}>{fmtYoy(cur, prev)}</span>
      </span>
    </div>
  );
}

/** 카드 안 한 줄 — 라벨 · 점선 · 값 */
function Kv({
  label,
  value,
  loading,
  cur,
  prev,
}: {
  label: string;
  value: string;
  loading?: boolean;
  /** 주면 값 뒤에 YoY 를 색과 함께 붙인다 (100% 이상 초록 / 미만 빨강) */
  cur?: number | null;
  prev?: number | null;
}) {
  const showYoy = cur !== undefined;
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-dashed border-[#E5EAF0] py-[7px]">
      {/* 라벨 색을 우측 값과 맞춘다 */}
      <span className={`shrink-0 text-xs font-medium ${loading ? 'text-[#9C7A43]' : 'text-[#15243B]'}`}>
        {label}
      </span>
      <span
        className={`truncate text-right text-[13px] font-semibold tabular-nums ${
          loading ? 'text-[#9C7A43]' : 'text-[#15243B]'
        }`}
      >
        {value}
        {showYoy && !loading && <span className={yoyTone(cur, prev)}>{fmtYoy(cur, prev)}</span>}
      </span>
    </div>
  );
}
