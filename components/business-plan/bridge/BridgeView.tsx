'use client';

import { useCallback, useEffect, useState } from 'react';
import './bridge.css';
import {
  aggregateP, BrandBridge, BrandData, BRAND_LABEL_MAP, bridge, BRIDGE_BRANDS,
  extract, fetchPL, fmtK, fmtKsigned, fmtPct, fmtPctSigned, VAT,
  opMargin, signCls, Totals,
} from './calc';
import Waterfall, { GEOM_ALL, GEOM_BRAND } from './Waterfall';

type TabKey = 'all' | string;

export default function BridgeView({
  brand,
}: {
  /** 좌측 사이드바에서 선택한 브랜드 ('all' = 법인) */
  brand: TabKey;
}) {
  const [yearCur, setYearCur] = useState(2026);
  const tab: TabKey = brand;
  const [data, setData] = useState<BrandData>({});
  const [all, setAll] = useState<BrandBridge | null>(null);
  const [loading, setLoading] = useState(true);
  const [errs, setErrs] = useState<string[]>([]);

  const load = useCallback(async (year: number) => {
    setLoading(true);
    setErrs([]);
    const yearPrev = year - 1;
    const failures: string[] = [];

    const results = await Promise.all(
      BRIDGE_BRANDS.map(async (b) => {
        try {
          const [j0, j1] = await Promise.all([fetchPL(b.api, yearPrev), fetchPL(b.api, year)]);
          const p0 = extract(j0);
          const p1 = extract(j1);
          return { key: b.key, v: { p0, p1, br: bridge(p0, p1) } as BrandBridge };
        } catch (e) {
          failures.push(`${b.label}: ${e instanceof Error ? e.message : String(e)}`);
          return { key: b.key, v: null };
        }
      }),
    );

    const next: BrandData = {};
    for (const r of results) if (r.v) next[r.key] = r.v;

    // 전체는 법인 API 를 먼저 시도하고, 실패하면 5브랜드 합산으로 대체
    let allData: BrandBridge | null = null;
    try {
      const [j0, j1] = await Promise.all([fetchPL('all', yearPrev), fetchPL('all', year)]);
      const p0 = extract(j0);
      const p1 = extract(j1);
      allData = { p0, p1, br: bridge(p0, p1) };
    } catch {
      const p0 = aggregateP(next, 'p0');
      const p1 = aggregateP(next, 'p1');
      if (p0 && p1) allData = { p0, p1, br: bridge(p0, p1) };
    }

    setData(next);
    setAll(allData);
    setErrs(failures);
    setLoading(false);
  }, []);

  useEffect(() => { load(yearCur); }, [load, yearCur]);

  // 탭 배지 — 전체는 5브랜드 ΔOP 합산 (원본 setTopKPI 와 동일)
  const totals = sumBrands(data);
  const allTabDelta = totals.op1 - totals.op0;

  return (
    <div className="page-bridge">
      <nav className="tabbar">
        <span className="yrsel">
          당년
          <select value={yearCur} onChange={(e) => setYearCur(Number(e.target.value))}>
            <option value={2026}>2026</option>
            <option value={2025}>2025</option>
          </select>
        </span>
      </nav>

      {tab === 'all'
        ? <AllPane data={data} all={all} yearCur={yearCur} loading={loading} errs={errs} />
        : <BrandPane brandKey={tab} data={data} loading={loading} />}
    </div>
  );
}

/* ── 5브랜드 합산 (탭 배지·상단 KPI 용) ─────────────────────── */
function sumBrands(data: BrandData) {
  let op0 = 0, op1 = 0, sales0 = 0, sales1 = 0;
  let topBrand: string | null = null;
  let topDelta = -Infinity;
  const lossBrands: { k: string; op: number }[] = [];

  for (const b of BRIDGE_BRANDS) {
    const d = data[b.key];
    if (!d) continue;
    op0 += d.p0.op || 0;
    op1 += d.p1.op || 0;
    sales0 += d.p0.sales || 0;
    sales1 += d.p1.sales || 0;
    if (d.br.deltaOP > topDelta) { topDelta = d.br.deltaOP; topBrand = b.key; }
    if ((d.p1.op ?? 0) < 0) lossBrands.push({ k: b.key, op: d.p1.op ?? 0 });
  }
  return { op0, op1, sales0, sales1, topBrand, topDelta, lossBrands };
}

/* ═══ 전체 탭 ═════════════════════════════════════════════════ */
function AllPane({ data, all, yearCur, loading, errs }: {
  data: BrandData; all: BrandBridge | null; yearCur: number;
  loading: boolean; errs: string[];
}) {
  const t = sumBrands(data);
  const delta = t.op1 - t.op0;

  return (
    <div className="wrap">
      <header>
        <div className="eyebrow">F&amp;F CHINA · 사업계획</div>
        <h1>
          영업이익 Bridge — F&amp;F CHINA 5브랜드
          <small>
            {yearCur - 1} 실적 → {yearCur} 목표 · 단위 K위안 · 매출=실판 V+ ·
            이익률=실판 V− 대비 · 할인율 = 1 − 실판V+ / Tag
          </small>
        </h1>
        <p>
          MLB · MLB KIDS · Discovery · Duvetica · SUPRA 합산 영업이익{' '}
          <b>{fmtK(t.op0)} → {fmtK(t.op1)} K위안 ({fmtKsigned(delta)})</b>.
          상단 탭에서 브랜드별 상세 Bridge 로 이동할 수 있습니다.
        </p>
      </header>

      {errs.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--neg)' }}>
          <h2>일부 브랜드 로드 실패</h2>
          {errs.map((e, i) => <div key={i} className="story">· {e}</div>)}
        </div>
      )}

      <div className="kpis">
        <Kpi l="F&F CHINA 5브랜드 당년 영업이익" v={fmtK(t.op1)}
          s={`전년 ${fmtK(t.op0)} · ${fmtKsigned(delta)}`} />
        <Kpi l="실판매출 (V+)" v={fmtK(t.sales1 * VAT)}
          s={`전년 ${fmtK(t.sales0 * VAT)} · ${fmtKsigned((t.sales1 - t.sales0) * VAT)}`} />
        <Kpi l="최대 증익 브랜드" v={t.topBrand ? BRAND_LABEL_MAP[t.topBrand] : '–'}
          s={t.topBrand ? `증익 ${fmtKsigned(t.topDelta)}` : '–'} />
        <Kpi l="적자 브랜드"
          v={t.lossBrands.length === 0 ? '없음' : t.lossBrands.map((x) => BRAND_LABEL_MAP[x.k]).join(', ')}
          s={t.lossBrands.length === 0 ? '모든 브랜드 흑자'
            : t.lossBrands.map((x) => `${BRAND_LABEL_MAP[x.k]} ${fmtK(x.op)}`).join(' · ')} />
      </div>

      <div className="card">
        <h2>① 5브랜드 합산 영업이익 Bridge <small>워터폴 · K위안</small></h2>
        {all
          ? <Waterfall p0={all.p0} p1={all.p1} br={all.br} geom={GEOM_ALL} label="F&F CHINA 5브랜드" />
          : <div className="story">{loading ? '불러오는 중…' : '데이터 없음'}</div>}
        <div className="legend">
          <span className="lp">증익 요인</span><span className="ln">감익 요인</span>
          <span>영업이익(실적/목표)</span>
        </div>
        <div className="note">
          할인율 = 1 − 실판V+ / Tag (실판V+ = 실판V− × 1.13). 항목: 전년 영업이익 → Tag매출 → 할인율 → 매출원가율
          → 평가감 → 직접비 → 영업비 → 당년 영업이익.
        </div>
      </div>

      <div className="card">
        <h2>② 브랜드 × 항목 비교 매트릭스 <small>효과(K위안) · – = 해당 없음/미미</small></h2>
        <Matrix data={data} />
        <div className="note">
          할인율 = 1 − 실판V+ / Tag. 각 브랜드 열의 합(항목 6개) ≒ 해당 브랜드 증감.
          잔차는 반올림/버킷 정의에 따른 오차.
        </div>
      </div>

      <div className="note">
        기준: F&amp;F CHINA · {yearCur - 1} 실적 · {yearCur} 사업계획 ·
        데이터는 <code>D:/dashboard/FS260312</code> 원본 CSV + Snowflake 실시간 조회.
      </div>
    </div>
  );
}

function Kpi({ l, v, s }: { l: string; v: string; s: string }) {
  return <div className="kpi"><div className="l">{l}</div><div className="v">{v}</div><div className="s">{s}</div></div>;
}

const MX_ROWS: { key: string; label: string; dot?: 'pos' | 'neg'; signed: boolean; tot?: boolean;
  get: (d: BrandBridge) => number | null }[] = [
  { key: 'op0',   label: '전년 영업이익 (실적)', signed: false, tot: true, get: (d) => d.p0.op },
  { key: 'vol',   label: 'Tag매출',         dot: 'pos', signed: true, get: (d) => d.br.vol },
  { key: 'disc',  label: '할인율',          dot: 'pos', signed: true, get: (d) => d.br.disc },
  { key: 'cogs',  label: '매출원가율',      dot: 'neg', signed: true, get: (d) => d.br.cogs },
  { key: 'vltn',  label: '평가감',          dot: 'neg', signed: true, get: (d) => d.br.vltn },
  { key: 'dc',    label: '직접비',          dot: 'neg', signed: true, get: (d) => d.br.dc },
  { key: 'opx',   label: '영업비',          dot: 'neg', signed: true, get: (d) => d.br.opx },
  { key: 'op1',   label: '당년 영업이익 (목표)', signed: false, tot: true, get: (d) => d.p1.op },
  { key: 'delta', label: '증감', signed: true, get: (d) => d.br.deltaOP },
];

function Matrix({ data }: { data: BrandData }) {
  return (
    <div className="tblwrap">
      <table>
        <thead>
          <tr>
            <th>항목</th>
            {BRIDGE_BRANDS.map((b) => <th key={b.key} className="num">{b.label}</th>)}
            <th className="num">합산</th>
          </tr>
        </thead>
        <tbody>
          {MX_ROWS.map((r) => {
            let sum = 0;
            let any = false;
            const cells = BRIDGE_BRANDS.map((b) => {
              const d = data[b.key];
              const v = d ? r.get(d) : null;
              if (v != null && isFinite(v)) { sum += v; any = true; }
              return { key: b.key, v };
            });
            const fmt = r.signed ? fmtKsigned : fmtK;
            return (
              <tr key={r.key} className={r.tot ? 'tot' : ''}>
                <td className={r.key === 'delta' ? 'muted' : ''}>
                  {r.dot && <span className={`dot ${r.dot}`} />}{r.label}
                </td>
                {cells.map((c) => (
                  <td key={c.key} className={`num ${r.signed ? signCls(c.v) : ''}`}>{fmt(c.v)}</td>
                ))}
                <td className="num">{any ? fmt(sum) : '–'}</td>
              </tr>
            );
          })}
          <tr>
            <td className="muted">이익률 전년 → 당년</td>
            {BRIDGE_BRANDS.map((b) => {
              const d = data[b.key];
              return (
                <td key={b.key} className="num">
                  {d ? `${fmtPct(opMargin(d.p0))} → ${fmtPct(opMargin(d.p1))}` : '–'}
                </td>
              );
            })}
            <td className="num">–</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ═══ 브랜드 탭 ═══════════════════════════════════════════════ */
const PL_LINES: { acc: keyof Totals; label: string; sub?: boolean }[] = [
  { acc: 'tag',   label: 'Tag매출' },
  { acc: 'sales', label: '실판매출 (V−)' },
  { acc: 'cogs',  label: '매출원가' },
  { acc: 'vltn',  label: '평가감(순)' },
  { acc: 'gp',    label: '매출총이익', sub: true },
  { acc: 'dc',    label: '직접비' },
  { acc: 'opx',   label: '영업비' },
  { acc: 'op',    label: '영업이익', sub: true },
];

const BR_ROWS: { key: string; label: string; dot?: 'pos' | 'neg'; basis: string;
  get: (d: BrandBridge) => number }[] = [
  { key: 'vol',  label: 'Tag매출', dot: 'pos', basis: 'ΔTag × (1 − 전년할인율 − 전년원가율) ÷ 1.13', get: (d) => d.br.vol },
  { key: 'disc', label: '할인율 (1 − 실판V+/Tag)', dot: 'pos', basis: '(disc0 − disc1) × Tag1', get: (d) => d.br.disc },
  { key: 'cogs', label: '매출원가율', dot: 'neg', basis: '(COGS0/Tag0 − COGS1/Tag1) × Tag1', get: (d) => d.br.cogs },
  { key: 'vltn', label: '평가감', dot: 'neg', basis: '−(평가감1 − 평가감0)', get: (d) => d.br.vltn },
  { key: 'dc',   label: '직접비', dot: 'neg', basis: '−(직접비1 − 직접비0)', get: (d) => d.br.dc },
  { key: 'opx',  label: '영업비', dot: 'neg', basis: '−(영업비1 − 영업비0)', get: (d) => d.br.opx },
];

function BrandPane({ brandKey, data, loading }: {
  brandKey: string; data: BrandData; loading: boolean;
}) {
  const d = data[brandKey];
  const label = BRAND_LABEL_MAP[brandKey] || brandKey;

  if (!d) {
    return <div className="wrap"><div className="card">{loading ? '불러오는 중…' : `${label} 데이터를 불러오지 못했습니다.`}</div></div>;
  }

  const { p0, p1, br } = d;
  const opm0 = opMargin(p0);
  const opm1 = opMargin(p1);

  return (
    <div className="wrap">
      <header>
        <div className="eyebrow">F&amp;F CHINA · 사업계획</div>
        <h1>
          {label} 영업이익 Bridge
          <small>전년 실적 → 당년 목표 · 단위 K위안 · 매출=실판 V+ · 할인율 = 1 − 실판V+ / Tag</small>
        </h1>
        <p>
          당년 목표 영업이익 <b>{fmtK(p1.op)} K위안 ({fmtKsigned(br.deltaOP)})</b>을 구성하는
          증익/감익 요인을 항목별로 분해했습니다.
        </p>
      </header>

      <div className="kpis">
        <Kpi l="당년 영업이익 목표" v={fmtK(p1.op)} s={`전년 ${fmtK(p0.op)} · ${fmtKsigned(br.deltaOP)}`} />
        <Kpi l="영업이익률" v={fmtPct(opm1)}
          s={`전년 ${fmtPct(opm0)} · ${fmtPctSigned((opm1 ?? 0) - (opm0 ?? 0))}`} />
        <Kpi l="실판매출 (V+)" v={fmtK(p1.sales)}
          s={`전년 ${fmtK(p0.sales)} · ${fmtKsigned((p1.sales ?? 0) - (p0.sales ?? 0))}`} />
        <Kpi l="할인율 (TAG 대비)" v={fmtPct(br.disc1)}
          s={`전년 ${fmtPct(br.disc0)} · ${fmtPctSigned(br.disc1 - br.disc0)}`} />
      </div>

      <div className="card">
        <h2>① 영업이익 Bridge <small>워터폴 · K위안</small></h2>
        <div className="sub">할인율 = 1 − 실판V+ / Tag. Tag매출 증감과 율(할인·원가·평가감·비용) 효과를 분리.</div>
        <Waterfall p0={p0} p1={p1} br={br} geom={GEOM_BRAND} label={label} />
        <div className="legend">
          <span className="lp">증익 요인</span><span className="ln">감익 요인</span>
          <span>영업이익(실적/목표)</span>
        </div>
      </div>

      <div className="card">
        <h2>② Bridge 항목별 산식 <small>단위 K위안</small></h2>
        <div className="tblwrap">
          <table>
            <thead><tr><th>항목</th><th className="num">효과(K위안)</th><th>산식 · 근거</th></tr></thead>
            <tbody>
              <tr className="tot"><td>전년 영업이익 (실적)</td><td className="num">{fmtK(p0.op)}</td><td>결산 실적</td></tr>
              {BR_ROWS.map((r) => {
                const v = r.get(d);
                return (
                  <tr key={r.key}>
                    <td>{r.dot && <span className={`dot ${r.dot}`} />}{r.label}</td>
                    <td className={`num ${signCls(v)}`}>{fmtKsigned(v)}</td>
                    <td className="basis">{r.basis}</td>
                  </tr>
                );
              })}
              <tr className="tot">
                <td>당년 영업이익 (목표)</td>
                <td className="num">{fmtK(p1.op)}</td>
                <td>증감 <b>{fmtKsigned(br.deltaOP)}</b></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="note">
          할인율 = 1 − 실판V+ / Tag. Tag매출 효과 = ΔTag × (1 − 전년할인율 − 전년원가율) ÷ 1.13.
          율 효과는 당년 Tag 기준으로 전·당년 율 차이를 금액화.
          항목 합 ≒ 실제 증감 (잔차 {fmtKsigned(br.resid)} = 반올림·버킷 정의 차이).
        </div>
      </div>

      <div className="card">
        <h2>③ 손익 라인별 증감 <small>전년 실적 vs 당년 목표</small></h2>
        <div className="tblwrap">
          <table>
            <thead>
              <tr><th>계정</th><th className="num">전년</th><th className="num">당년</th><th className="num">증감</th></tr>
            </thead>
            <tbody>
              {PL_LINES.map((l) => {
                const v0 = p0[l.acc];
                const v1 = p1[l.acc];
                const delta = v1 != null && v0 != null ? v1 - v0 : null;
                return (
                  <tr key={l.acc} className={l.sub ? 'sub' : ''}>
                    <td>{l.label}</td>
                    <td className="num">{fmtK(v0)}</td>
                    <td className="num">{fmtK(v1)}</td>
                    <td className={`num ${signCls(delta)}`}>{fmtKsigned(delta)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="note">
          단위 K위안. 실판매출은 코드베이스 정의상 V− 라인이지만 매출 지표로 사용.
          기준월 12월 기준 — 연간 전체 합계.
        </div>
      </div>
    </div>
  );
}
