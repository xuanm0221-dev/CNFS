'use client';

/**
 * 사업계획 (PL) — 연간 손익계산서.
 * 데이터는 기존 API 를 그대로 사용하므로 별도 계산 로직이 없다.
 *   전체   : /api/fs/pl?year=&baseMonth=
 *   브랜드 : /api/fs/pl/brand?brand=&year=&baseMonth=
 * 연도는 2026 고정.
 */
import { useCallback, useEffect, useState } from 'react';
import { BP_BRANDS, BrandKey, YEAR, plUrl } from './shared';

const BRANDS = BP_BRANDS;

/** 표에 표시할 계정 — account 는 fs-mapping 의 row.account 문자열 그대로 */
type LineCls = 'plain' | 'emph' | 'hl' | 'hl2' | 'grp' | 'sub';

interface Line {
  account: string;
  label: string;
  cls: LineCls;
  sign?: 'positive' | 'negative_abs';
}

const LINES: Line[] = [
  { account: 'Tag매출', label: 'Tag매출', cls: 'plain' },
  { account: '실판매출', label: '실판매출', cls: 'emph' },
  { account: '매출원가', label: '매출원가', cls: 'plain' },
  { account: '평가감', label: '평가감', cls: 'plain' },
  { account: '평가감(설정)', label: '평가감(설정)', cls: 'sub' },
  { account: '평가감(환입)', label: '평가감(환입)', cls: 'sub' },
  { account: '매출총이익', label: '매출총이익', cls: 'hl2' },

  { account: '직접비', label: '직접비', cls: 'grp' },
  { account: '급여(매장)', label: '급여(매장)', cls: 'sub' },
  { account: '복리후생비(매장)', label: '복리후생비(매장)', cls: 'sub' },
  { account: '플랫폼수수료', label: '플랫폼수수료', cls: 'sub' },
  { account: 'TP수수료', label: 'TP수수료', cls: 'sub' },
  { account: '직접광고비', label: '직접광고비', cls: 'sub' },
  { account: '대리상지원금', label: '대리상지원금', cls: 'sub' },
  { account: '물류비', label: '물류비', cls: 'sub' },
  { account: '매장임차료', label: '매장임차료', cls: 'sub' },
  { account: '감가상각비', label: '감가상각비', cls: 'sub' },
  { account: '기타(직접비)', label: '기타(직접비)', cls: 'sub' },

  { account: '영업비', label: '영업비', cls: 'grp' },
  { account: '급여(사무실)', label: '급여(사무실)', cls: 'sub' },
  { account: '복리후생비(사무실)', label: '복리후생비(사무실)', cls: 'sub' },
  { account: '광고비', label: '광고비', cls: 'sub' },
  { account: '수주회', label: '수주회', cls: 'sub' },
  { account: '지급수수료', label: '지급수수료', cls: 'sub' },
  { account: '임차료', label: '임차료', cls: 'sub' },
  { account: '감가상각비(영업비)', label: '감가상각비(영업비)', cls: 'sub' },
  { account: '세금과공과', label: '세금과공과', cls: 'sub' },
  { account: '기타(영업비)', label: '기타(영업비)', cls: 'sub' },

  { account: '영업이익(관리식)', label: '영업이익', cls: 'hl' },
];

interface PlRow {
  account: string;
  values?: (number | null)[];
  comparisons?: { prevYearAnnual?: number | null; currYearAnnual?: number | null };
}

/** 위안 → K위안 */
function fk(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '–';
  const k = Math.round(v / 1000);
  return k === 0 ? '0' : k.toLocaleString('ko-KR');
}

function fpct(a: number | null | undefined, b: number | null | undefined): string {
  if (a == null || !b) return '–';
  const r = a / b - 1;
  return `${r >= 0 ? '+' : ''}${(r * 100).toFixed(1)}%`;
}

function pctTone(a: number | null | undefined, b: number | null | undefined): string {
  if (a == null || !b) return 'text-[#6A7686]';
  return a / b >= 1 ? 'text-[#176B43]' : 'text-[#A93B33]';
}

/** 행 구분별 스타일 — pl.html 의 tr.hl / hl2 / emph / grp / sub 대응 */
const ROW_STYLE: Record<LineCls, { tr: string; label: string; plan: string }> = {
  plain: { tr: '', label: 'font-medium text-[#15243B]', plan: 'bg-[#fff8ea] text-[#9C7A43]' },
  emph: { tr: 'bg-[#fff8ea] font-bold text-[#9C7A43]', label: 'font-bold text-[#9C7A43]', plan: 'bg-[#f5e9c8]' },
  hl2: { tr: 'bg-[#eef2f7] font-bold', label: 'font-bold text-[#15243B]', plan: 'bg-[#e6ddc4]' },
  hl: { tr: 'bg-[#f3ece0] font-bold border-t-[1.5px] border-[#9C7A43]', label: 'font-bold text-[#15243B]', plan: 'bg-[#efe4c8]' },
  grp: { tr: 'bg-[#f5f7fa] font-bold text-[#15243B] border-t border-[#9C7A43]', label: 'font-bold text-[#15243B]', plan: 'bg-[#eae5d0]' },
  sub: { tr: 'text-[11px] text-[#5a6678]', label: 'pl-6 font-normal text-[#6a7686]', plan: 'bg-[#fff8ea] text-[#a38857]' },
};

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export default function BusinessPlanView({
  brand,
  baseMonth,
}: {
  brand: BrandKey;
  baseMonth: number;
}) {
  const bm = baseMonth; // 재무제표 대시보드 기준월을 그대로 따른다
  const [rows, setRows] = useState<PlRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(plUrl(brand, YEAR, bm), { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json: { rows?: PlRow[] }) => setRows(json.rows ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [brand, bm]);

  useEffect(() => {
    load();
  }, [load]);

  const byAcc = new Map((rows ?? []).map((r) => [r.account, r]));
  const brandLabel = BRANDS.find((b) => b.key === brand)?.label ?? '';

  return (
    <div className="min-h-screen bg-[#EEF1F4] text-[13px] text-[#1A1A1A]">
      <div className="mx-auto max-w-[1400px] px-6 pb-20 pt-5">
        {/* 헤더 */}
        <div className="mb-3.5 flex items-end justify-between border-b border-t-[3px] border-b-[#9C7A43] border-t-[#15243B] pb-2.5 pt-3">
          <div>
            <div className="text-[11px] tracking-wide text-[#6A7686]">
              F&amp;F CHINA · 경영관리 · FICO 재무기준
            </div>
            <h1 className="text-[19px] font-bold text-[#15243B]">사업계획 — 손익계산서 (연간)</h1>
          </div>
          <div className="text-right text-[11px] text-[#6A7686]">
            단위 <b className="font-medium text-[#34506F]">K위안</b> · 실적/계획은 기준월 기준
          </div>
        </div>

        {/* 컨트롤 바 */}
        <div className="mb-3.5 flex flex-wrap items-center gap-4 border border-[#C9D2DC] bg-white px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[#6A7686]">브랜드</span>
            <span className="border border-[#9C7A43] bg-[#9C7A43] px-3 py-1.5 text-xs font-medium text-white">
              {brandLabel}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[#6A7686]">연도</span>
            <span className="border border-[#9C7A43] bg-[#9C7A43] px-3 py-1.5 text-xs font-medium text-white">
              {YEAR}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[#6A7686]">기준월</span>
            <span className="border border-[#C9D2DC] bg-white px-3 py-1.5 text-xs font-semibold text-[#34506F]">
              {bm}월
            </span>
          </div>

          <div className="ml-2 inline-flex gap-2.5 text-[11px] text-[#6A7686]">
            <span>
              <span className="mr-1 inline-block h-2.5 w-2.5 border border-[#C9D2DC] align-middle" />
              실적
            </span>
            <span>
              <span className="mr-1 inline-block h-2.5 w-2.5 border border-[#C9D2DC] bg-[#fff8ea] align-middle" />
              계획
            </span>
          </div>
        </div>

        {/* 섹션 제목 */}
        <div className="mb-2 mt-4 flex items-center gap-2.5 border-b-[1.5px] border-[#15243B] pb-1 text-[13.5px] font-bold text-[#15243B]">
          <span className="text-[#9C7A43]">01</span>
          <span>연간 손익계산서 — {YEAR}년</span>
          <span className="ml-auto text-[11px] font-normal text-[#6A7686]">
            기준월 이하는 실적, 이후는 계획
          </span>
        </div>

        {loading && (
          <div className="border border-dashed border-[#C9D2DC] bg-white p-10 text-center text-[#6A7686]">
            불러오는 중…
          </div>
        )}

        {error && (
          <div className="border border-[#A93B33] bg-[#fff5f4] p-6 text-xs leading-7 text-[#A93B33]">
            <b>데이터 로드 실패</b> — {error}
          </div>
        )}

        {!loading && !error && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse bg-white text-xs">
              <thead>
                <tr>
                  <th className="whitespace-nowrap bg-[#15243B] px-2 py-1.5 text-left text-[11px] font-medium text-[#eef2f7]">
                    계정
                  </th>
                  {MONTHS.map((m) => (
                    <th
                      key={m}
                      className={`whitespace-nowrap px-2 py-1.5 text-right text-[11px] font-medium text-[#eef2f7] ${
                        m > bm ? 'bg-[#7a6237]' : 'bg-[#15243B]'
                      }`}
                    >
                      {`${m}월`}
                      {m > bm && <div className="text-[9px] font-normal text-[#c9b98a]">(계획)</div>}
                    </th>
                  ))}
                  <th className="whitespace-nowrap border-l-2 border-[#9C7A43] bg-[#15243B] px-2 py-1.5 text-right text-[11px] font-medium text-[#eef2f7]">
                    연간
                  </th>
                  <th className="whitespace-nowrap bg-[#15243B] px-2 py-1.5 text-right text-[11px] font-medium text-[#eef2f7]">
                    전년 연간
                  </th>
                  <th className="whitespace-nowrap bg-[#15243B] px-2 py-1.5 text-right text-[11px] font-medium text-[#eef2f7]">
                    YoY
                  </th>
                </tr>
              </thead>
              <tbody>
                {LINES.map((line, idx) => {
                  const st = ROW_STYLE[line.cls];
                  const row = byAcc.get(line.account);
                  const key = `${line.account}-${idx}`;

                  if (!row) {
                    return (
                      <tr key={key} className={st.tr}>
                        <td className={`border-b border-[#E5EAF0] px-2 py-1.5 text-left ${st.label}`}>
                          {line.label}
                        </td>
                        {Array.from({ length: 15 }, (_, i) => (
                          <td
                            key={i}
                            className="border-b border-[#E5EAF0] px-2 py-1.5 text-right text-[#6A7686]"
                          >
                            –
                          </td>
                        ))}
                      </tr>
                    );
                  }

                  // 평가감 설정/환입은 같은 계정을 부호로 갈라 쓴다
                  const vals = (row.values ?? []).map((v) => {
                    if (v == null) return null;
                    if (line.sign === 'positive') return v > 0 ? v : null;
                    if (line.sign === 'negative_abs') return v < 0 ? -v : null;
                    return v;
                  });

                  let annual = 0;
                  let anyVal = false;
                  for (let m = 0; m < 12; m += 1) {
                    const v = vals[m];
                    if (v != null) {
                      annual += v;
                      anyVal = true;
                    }
                  }

                  const c = row.comparisons ?? {};
                  // 부호 필터가 걸린 행은 전년 비교를 쓸 수 없다
                  const prevAnn = line.sign ? null : c.prevYearAnnual ?? null;
                  const currAnn = line.sign ? (anyVal ? annual : null) : c.currYearAnnual ?? annual;

                  return (
                    <tr key={key} className={st.tr}>
                      <td className={`border-b border-[#E5EAF0] px-2 py-1.5 text-left ${st.label}`}>
                        {line.label}
                      </td>
                      {MONTHS.map((m) => (
                        <td
                          key={m}
                          className={`border-b border-[#E5EAF0] px-2 py-1.5 text-right tabular-nums ${
                            m > bm ? st.plan : ''
                          }`}
                        >
                          {fk(vals[m - 1])}
                        </td>
                      ))}
                      <td className="border-b border-l-2 border-[#E5EAF0] border-l-[#9C7A43] px-2 py-1.5 text-right tabular-nums">
                        {anyVal ? fk(annual) : '–'}
                      </td>
                      <td className="border-b border-[#E5EAF0] px-2 py-1.5 text-right tabular-nums text-[#6A7686]">
                        {fk(prevAnn)}
                      </td>
                      <td
                        className={`border-b border-[#E5EAF0] px-2 py-1.5 text-right tabular-nums ${pctTone(
                          currAnn,
                          prevAnn,
                        )}`}
                      >
                        {fpct(currAnn, prevAnn)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-2.5 text-[11px] leading-7 text-[#6A7686]">
          · <b>실적/계획 구분</b>: 기준월({bm}월) 이하 = 실적, 초과 = 계획
          <br />· <b>단위</b>: K위안 (원자료 ÷ 1,000, 반올림)
          <br />· <b>데이터 출처</b>: 재무제표 대시보드와 동일한 API (
          <code className="border border-[#C9D2DC] bg-white px-1">파일/PL_brand/…</code>)
          <br />· CSV 를 수정하면 서버 재시작 없이 새로고침으로 반영됩니다.
        </div>
      </div>
    </div>
  );
}
