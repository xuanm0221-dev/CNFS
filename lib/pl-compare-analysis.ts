// 지난달 보고 대비 — 연간 증감 자동 분석
//
// 모달이 이미 받아 둔 비교 행에서 파생하므로 별도 API 가 없다.
// 표에 보이는 숫자와 문장이 같은 소스를 쓰게 해서 어긋날 여지를 없앤다.
//
// 부호 규약: diff = 현재 버전 − 전월 보고본.
//   매출·이익은 diff>0 이 증가(개선), 비용·원가는 diff>0 이 증가(악화).
//   영업이익 diff = 실판매출 diff − 매출원가합계 diff − 직접비 diff − 영업비 diff (항등식)
import type { PLCompareResponse } from '@/app/api/fs/pl/compare/route';

type Row = PLCompareResponse['rows'][number];

export interface AnalysisLine {
  /** 'ㄴ' 들여쓰기 여부 */
  sub?: boolean;
  text: string;
  /** 증감 방향 — 색으로 구분 */
  tone?: 'up' | 'down' | 'flat';
  /**
   * 브랜드·채널·계정을 한 줄씩 세우는 목록. 있으면 text 는 소제목으로 쓰고
   * 항목은 이름 왼쪽 / 금액 오른쪽으로 정렬해 그린다.
   */
  items?: { label: string; value: number; note?: string }[];
}

export interface AnalysisSection {
  title: string;
  /** 제목 옆에 붙는 대표 금액 (K위안) */
  headline?: number | null;
  /**
   * 헤드라인 색 기준. 숫자 부호가 아니라 '이익에 좋은가' 로 칠한다 —
   * 비용이 줄면 금액은 음수지만 이익에는 플러스라 초록이어야 한다.
   */
  headlineTone?: AnalysisLine['tone'];
  /** 헤드라인 금액 오른쪽에 괄호로 붙는 짧은 보조 지표 */
  headlineNote?: string;
  /** 넓은 칸이 필요한 카드 (항목 옆에 원가율 괄호가 붙어 길다) */
  wide?: boolean;
  lines: AnalysisLine[];
}

/** K위안 정수 — 표의 fmtK 와 같은 규칙(△ 음수) */
function k(v: number | null | undefined): number {
  if (v == null || Number.isNaN(v)) return 0;
  return Math.round(v / 1000);
}

function fmt(v: number, sign = true): string {
  const a = new Intl.NumberFormat('ko-KR').format(Math.abs(v));
  if (v < 0) return `△${a}`;
  return sign && v > 0 ? `+${a}` : a;
}

function annual(values: (number | null)[]): number {
  let sum = 0;
  for (const v of values) if (v != null && !Number.isNaN(v)) sum += v;
  return sum;
}

/** 연간 증감 (현재 − 전월), 元 단위 */
function diff(row: Row | undefined): number {
  if (!row) return 0;
  return annual(row.current) - annual(row.baseline);
}

function find(rows: Row[], account: string): Row | undefined {
  return rows.find((r) => r.account === account);
}

/** 부모 바로 아래 하위 행 (다음 상위 레벨 행 전까지) */
function childrenOf(rows: Row[], account: string): Row[] {
  const i = rows.findIndex((r) => r.account === account);
  if (i < 0) return [];
  const parentLevel = rows[i].level;
  const out: Row[] = [];
  for (const r of rows.slice(i + 1)) {
    if (r.level <= parentLevel) break;
    if (r.level === parentLevel + 1) out.push(r);
  }
  return out;
}

/** 증감 절대값 상위 N개 (0 인 항목 제외) */
function topMovers(rows: Row[], parent: string, n = 3): { label: string; d: number }[] {
  return childrenOf(rows, parent)
    .map((r) => ({ label: r.label, d: diff(r) }))
    .filter((x) => k(x.d) !== 0)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, n);
}

function tone(v: number, higherIsBetter: boolean): AnalysisLine['tone'] {
  if (k(v) === 0) return 'flat';
  const good = higherIsBetter ? v > 0 : v < 0;
  return good ? 'up' : 'down';
}

/** 증감 목록을 K위안 항목으로 — 화면에서 한 줄씩 세운다 */
function toItems(
  list: { label: string; d: number }[],
  note?: (label: string) => string | undefined,
): { label: string; value: number; note?: string }[] {
  return list.map((x) => ({ label: x.label, value: k(x.d), note: note?.(x.label) }));
}


export interface AnalysisInput {
  rows: Row[];
  /**
   * Bridge 드릴다운과 같은 구성 데이터. 법인 탭의 브랜드별 매출원가·평가감은
   * rows 에 없고 여기에만 있으므로, 분석도 같은 소스를 봐야 숫자가 어긋나지 않는다.
   */
  details?: Record<string, { label: string; current: (number | null)[]; baseline: (number | null)[] }[]>;
  /** 'all' 이면 법인 */
  brand: string;
  /** 전월 보고본 파일이 실제로 있는 브랜드 */
  baselineBrands: string[];
  /** 결산이 끝나 증감이 0 인 분기 수 */
  closedQuarters: number;
}

export function buildCompareAnalysis(input: AnalysisInput): AnalysisSection[] {
  const { rows, brand, details } = input;
  if (rows.length === 0) return [];

  const isCorporate = brand === 'all';
  /** 법인이면 브랜드로, 브랜드 탭이면 채널로 쪼갠다 */
  const childAxis = isCorporate ? '브랜드' : '채널';

  const dTag = diff(find(rows, 'Tag매출'));
  const dNet = diff(find(rows, '실판매출'));
  const dCogs = diff(find(rows, '매출원가'));
  const dProv = diff(find(rows, '평가감(설정)'));
  const dRev = diff(find(rows, '평가감(환입)'));
  const dVltn = dProv + dRev;
  const dGross = diff(find(rows, '매출총이익'));
  const dDirect = diff(find(rows, '직접비'));
  const dOpex = diff(find(rows, '영업비'));
  const dOp = diff(find(rows, '영업이익(관리식)'));

  /**
   * Bridge 드릴다운(details)에서 항목을 뽑는다.
   *   브랜드·채널 → API 가 정한 순서 그대로 (MLB…SUPRA / 대리상→직영). 자리가 고정돼야 눈이 익는다.
   *   계정(직접비·영업비) → 10개까지 있어 증감이 큰 것부터.
   */
  const splitMovers = (
    step: string,
    n = 5,
    sortBySize = false,
  ): { label: string; d: number }[] => {
    const list = (details?.[step] ?? [])
      .map((it) => ({ label: it.label, d: annual(it.current) - annual(it.baseline) }))
      .filter((x) => k(x.d) !== 0);
    if (sortBySize) list.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    return list.slice(0, n);
  };

  const sections: AnalysisSection[] = [];

  // ── ① 영업이익: 결론과 요인 분해 ──
  const conclusion: AnalysisLine[] = [];
  if (k(dOp) === 0) {
    conclusion.push({ text: '지난달 보고와 같습니다.', tone: 'flat' });
  } else {
    conclusion.push({
      text: `${fmt(k(dOp))} K위안 ${k(dOp) > 0 ? '개선' : '악화'}`,
      tone: tone(dOp, true),
    });
  }
  // 부호를 이익 효과로 뒤집어 합이 정확히 Δ영업이익이 되게 한다
  const factors = [
    { name: '실판매출', effect: dNet },
    { name: '원가', effect: -dCogs },
    { name: '평가감', effect: -dVltn },
    { name: '직접비', effect: -dDirect },
    { name: '영업비', effect: -dOpex },
  ]
    .filter((f) => k(f.effect) !== 0)
    .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
  if (factors.length > 0) {
    conclusion.push({
      sub: true,
      text: `이익효과 ${factors.map((f) => `${f.name} ${fmt(k(f.effect))}`).join(' / ')}`,
    });
  }
  sections.push({ title: '영업이익', headline: k(dOp), headlineTone: tone(dOp, true), lines: conclusion });

  // ── ② Tag매출 ──
  const tagMovers = splitMovers('Tag');
  sections.push({
    title: 'Tag매출',
    headline: k(dTag),
    headlineTone: tone(dTag, true),
    lines: [
      tagMovers.length > 0
        ? { sub: true, text: `${childAxis}별`, items: toItems(tagMovers) }
        : { sub: true, text: `${childAxis}별 변동 없음` },
    ],
  });

  // ── ③ 실판매출 (V− 기준) ──
  const salesLines: AnalysisLine[] = [];
  const netMovers = splitMovers('V−');
  salesLines.push(
    netMovers.length > 0
      ? { sub: true, text: `${childAxis}별`, items: toItems(netMovers) }
      : { sub: true, text: `${childAxis}별 변동 없음` },
  );
  sections.push({
    title: '실판매출(V−)',
    headline: k(dNet),
    headlineTone: tone(dNet, true),
    lines: salesLines,
  });

  // ── ③ 매출원가 ──
  const cogsLines: AnalysisLine[] = [];
  const cogsMovers = splitMovers('원가');
  if (cogsMovers.length > 0) {
    // 항목마다 Tag 대비 원가율(원가 × 1.13 ÷ Tag) 변화를 괄호로 붙인다.
    // 금액이 줄어도 원가율이 오르면 나빠진 것이라 둘을 같이 봐야 한다.
    const tagBy = new Map(
      (details?.['Tag'] ?? []).map((it) => [it.label, { b: annual(it.baseline), c: annual(it.current) }]),
    );
    const cogsBy = new Map(
      (details?.['원가'] ?? []).map((it) => [it.label, { b: annual(it.baseline), c: annual(it.current) }]),
    );
    const ratioNote = (label: string): string | undefined => {
      const t = tagBy.get(label);
      const c = cogsBy.get(label);
      if (!t || !c || t.b <= 0 || t.c <= 0) return undefined;
      const rb = ((c.b * 1.13) / t.b) * 100;
      const rc = ((c.c * 1.13) / t.c) * 100;
      return `${rb.toFixed(1)}→${rc.toFixed(1)}%`;
    };
    cogsLines.push({ sub: true, text: `${childAxis}별`, items: toItems(cogsMovers, ratioNote) });
  }
  // 원가율 — Bridge 와 같은 정의(매출원가 ÷ 실판매출 V−)
  const salesCur = annual(find(rows, '실판매출')?.current ?? []);
  const salesBase = annual(find(rows, '실판매출')?.baseline ?? []);
  const cogsCur = annual(find(rows, '매출원가')?.current ?? []);
  const cogsBase = annual(find(rows, '매출원가')?.baseline ?? []);
  if (salesCur > 0 && salesBase > 0) {
    const rCur = (cogsCur / salesCur) * 100;
    const rBase = (cogsBase / salesBase) * 100;
    const gap = rCur - rBase;
    cogsLines.push({
      sub: true,
      text: `실판대비 ${rBase.toFixed(1)}% → ${rCur.toFixed(1)}%${
        Math.abs(gap) >= 0.05 ? ` (${gap > 0 ? '+' : '△'}${Math.abs(gap).toFixed(1)}%p)` : ''
      }`,
      tone: Math.abs(gap) >= 0.05 ? tone(gap, false) : 'flat',
    });
  }
  // Tag 대비 원가율 — 손익계산서 (Tag 대비 원가율) 계산행과 같은 산식 (매출원가 × 1.13 ÷ Tag).
  // 줄을 따로 쓰면 카드가 길어져서 헤드라인 금액 옆에 괄호로 붙인다.
  const tagCur = annual(find(rows, 'Tag매출')?.current ?? []);
  const tagBase = annual(find(rows, 'Tag매출')?.baseline ?? []);
  let cogsNote: string | undefined;
  if (tagCur > 0 && tagBase > 0) {
    const tCur = ((cogsCur * 1.13) / tagCur) * 100;
    const tBase = ((cogsBase * 1.13) / tagBase) * 100;
    cogsNote = `Tag대비 ${tBase.toFixed(1)}%→${tCur.toFixed(1)}%`;
  }
  cogsLines.push({ sub: true, text: `매출총이익 ${fmt(k(dGross))}`, tone: tone(dGross, true) });
  sections.push({
    title: '매출원가',
    headline: k(dCogs),
    headlineTone: tone(dCogs, false),
    headlineNote: cogsNote,
    wide: true,
    lines: cogsLines,
  });

  // ── ④ 평가감 ──
  const vltnLines: AnalysisLine[] = [];
  const vParts = [
    { name: '설정', d: dProv },
    { name: '환입', d: dRev },
  ].filter((x) => k(x.d) !== 0);
  if (vParts.length > 0) {
    vltnLines.push({ sub: true, text: vParts.map((x) => `${x.name} ${fmt(k(x.d))}`).join(' / ') });
  }
  const vltnMovers = isCorporate ? splitMovers('평가감') : [];
  if (vltnMovers.length > 0) {
    vltnLines.push({ sub: true, text: '브랜드별', items: toItems(vltnMovers) });
  }
  if (vltnLines.length === 0) {
    vltnLines.push({ sub: true, text: '변동 없음' });
  }
  sections.push({
    title: '평가감',
    headline: k(dVltn),
    headlineTone: tone(dVltn, false),
    lines: vltnLines,
  });

  // ── ⑤ 직접비 / ⑥ 영업비 — 계정별 ──
  const expenseSection = (
    title: string,
    total: number,
    parent: string,
  ): AnalysisSection => {
    const movers = splitMovers(parent, 4, true);   // 계정은 10개까지 있어 큰 것부터 4개
    return {
      title,
      headline: k(total),
      headlineTone: tone(total, false),
      lines: [
        movers.length > 0
          ? { sub: true, text: '계정별', items: toItems(movers) }
          : { sub: true, text: '계정별 변동 없음' },
      ],
    };
  };
  sections.push(expenseSection('직접비', dDirect, '직접비'));
  sections.push(expenseSection('영업비', dOpex, '영업비'));

  return sections;
}


/* ── 영업이익 Bridge (전월 → 현재) ────────────────────────────
 *
 * 사업계획의 Bridge 는 전년→당년을 Tag매출·할인율·원가율로 나누지만,
 * 여기선 Tag·할인을 빼고 손익 구조 그대로 단순 증감으로 나눈다.
 *
 *   영업이익 = 실판매출(V−) − 매출원가 − 평가감 − 직접비 − 영업비  이므로
 *   V−   = +Δ실판매출
 *   원가 = −Δ매출원가
 *   평가감·직접비·영업비 = −Δ
 *
 * 5개 합 = Δ영업이익 (항등식). 원가율(매출원가÷실판V−) 변화는 원가 막대의
 * 툴팁에 함께 띄운다 — 금액 변동이 물량 때문인지 요율 때문인지 가려 보라고.
 */

export interface BridgeStep {
  label: string;
  /** 元 단위. total 은 절대값, delta 는 증감 */
  value: number;
  kind: 'total' | 'delta';
  /** 마우스오버 설명 */
  hint?: string;
}

export interface CompareBridge {
  /** 변동 요인 5개. 전월·현재 절대금액과 증감은 막대가 아니라 숫자로 보여 준다 */
  steps: BridgeStep[];
  /** 전월 보고본 연간 영업이익 */
  op0: number;
  /** 현재 버전 연간 영업이익 */
  op1: number;
  /** 부동소수 오차 (K위안 기준 0 이어야 정상) */
  resid: number;
}

export function buildCompareBridge(rows: Row[]): CompareBridge | null {
  const g = (acc: string, side: 'current' | 'baseline') => {
    const r = find(rows, acc);
    return r ? annual(r[side]) : 0;
  };
  const sales0 = g('실판매출', 'baseline');
  const sales1 = g('실판매출', 'current');
  if (sales0 === 0 && sales1 === 0) return null;

  const cogs0 = g('매출원가', 'baseline');
  const cogs1 = g('매출원가', 'current');
  const vltn0 = g('평가감(설정)', 'baseline') + g('평가감(환입)', 'baseline');
  const vltn1 = g('평가감(설정)', 'current') + g('평가감(환입)', 'current');
  const dc0 = g('직접비', 'baseline');
  const dc1 = g('직접비', 'current');
  const ox0 = g('영업비', 'baseline');
  const ox1 = g('영업비', 'current');
  const op0 = g('영업이익(관리식)', 'baseline');
  const op1 = g('영업이익(관리식)', 'current');

  const r0 = sales0 ? cogs0 / sales0 : 0;
  const r1 = sales1 ? cogs1 / sales1 : 0;

  const eSales = sales1 - sales0;
  const eCogs = -(cogs1 - cogs0);
  const eVltn = -(vltn1 - vltn0);
  const eDc = -(dc1 - dc0);
  const eOx = -(ox1 - ox0);

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  // 전월·현재 영업이익은 자릿수가 요인의 수십 배라 같이 그리면 요인 막대가 안 보인다.
  // 그래서 축은 '전월 대비 증감' 으로 두고, 절대금액은 차트 밖에 숫자로 낸다.
  const steps: BridgeStep[] = [
    {
      label: 'V−',
      value: eSales,
      kind: 'delta',
      hint: `실판매출(V−) ${fmt(k(sales0), false)} → ${fmt(k(sales1), false)} K위안`,
    },
    {
      label: '원가',
      value: eCogs,
      kind: 'delta',
      hint: `매출원가 ${fmt(k(cogs1 - cogs0))} K위안 · 원가율(÷실판V−) ${pct(r0)} → ${pct(r1)}`,
    },
    { label: '평가감', value: eVltn, kind: 'delta', hint: `평가감 ${fmt(k(vltn1 - vltn0))} K위안` },
    { label: '직접비', value: eDc, kind: 'delta', hint: `직접비 ${fmt(k(dc1 - dc0))} K위안` },
    { label: '영업비', value: eOx, kind: 'delta', hint: `영업비 ${fmt(k(ox1 - ox0))} K위안` },
    // 합계 막대는 두지 않는다 — 증감 금액은 차트 위 숫자 줄에 표시한다
  ];

  const sum = eSales + eCogs + eVltn + eDc + eOx;
  return { steps, op0, op1, resid: (op1 - op0) - sum };
}

/* ── 서술형 요약 ────────────────────────────────────────────
 *
 * 카드 위에 붙는 문장. 숫자에서 바로 나오는 것(데이터)과
 * 원인 해석(추정)을 문장마다 꼬리표로 갈라 둔다 — 해석을 사실처럼 읽지 않도록.
 */

export interface SummarySentence {
  kind: 'data' | 'estimate';
  text: string;
}

export function buildCompareSummary(input: AnalysisInput): SummarySentence[] {
  const { rows } = input;
  if (rows.length === 0) return [];

  const unit = (v: number) => `${fmt(k(v))} K위안`;
  const dTag = diff(find(rows, 'Tag매출'));
  const dNet = diff(find(rows, '실판매출'));
  const dCogs = diff(find(rows, '매출원가'));
  const dVltn = diff(find(rows, '평가감(설정)')) + diff(find(rows, '평가감(환입)'));
  const dDirect = diff(find(rows, '직접비'));
  const dOpex = diff(find(rows, '영업비'));
  const dOp = diff(find(rows, '영업이익(관리식)'));

  const sum = (acc: string, side: 'current' | 'baseline') => {
    const r = find(rows, acc);
    return r ? annual(r[side]) : 0;
  };
  const tagB = sum('Tag매출', 'baseline');
  const tagC = sum('Tag매출', 'current');
  const netB = sum('실판매출', 'baseline');
  const netC = sum('실판매출', 'current');
  const cogB = sum('매출원가', 'baseline');
  const cogC = sum('매출원가', 'current');

  const out: SummarySentence[] = [];

  // ① 결론 — 이익 효과가 큰 순서로 세운다 (부호는 이익 기준)
  const effects = [
    { name: '실판매출', v: dNet },
    { name: '원가', v: -dCogs },
    { name: '평가감', v: -dVltn },
    { name: '직접비', v: -dDirect },
    { name: '영업비', v: -dOpex },
  ]
    .filter((e) => k(e.v) !== 0)
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const plus = effects.filter((e) => e.v > 0);
  const minus = effects.filter((e) => e.v < 0);
  if (k(dOp) === 0) {
    out.push({ kind: 'data', text: '연간 영업이익(관리식)은 지난달 보고와 같습니다.' });
  } else {
    const drive = plus.length > 0 ? plus : minus;
    const drag = plus.length > 0 ? minus : plus;
    out.push({
      kind: 'data',
      text:
        `연간 영업이익(관리식)이 ${unit(dOp)} ${k(dOp) > 0 ? '개선' : '악화'}됐습니다. ` +
        `${drive.map((e) => `${e.name} ${fmt(k(e.v))}`).join(' · ')}` +
        (drag.length > 0
          ? ` 이 ${drag.map((e) => `${e.name} ${fmt(k(e.v))}`).join(' · ')} 을 ${k(dOp) > 0 ? '덮었습니다' : '넘지 못했습니다'}.`
          : ' 이 그대로 반영됐습니다.') +
        ' (이익 효과 기준 — 비용이 줄면 +)',
    });
  }

  // ② 매출 — Tag 와 실판이 다르게 움직였는지가 핵심
  if (tagB > 0 && tagC > 0) {
    const rB = (netB * 1.13) / tagB;
    const rC = (netC * 1.13) / tagC;
    const discB = (1 - rB) * 100;
    const discC = (1 - rC) * 100;
    const gap = discC - discB;
    out.push({
      kind: 'data',
      text:
        `Tag매출 ${fmt(k(dTag))} / 실판매출(V−) ${fmt(k(dNet))} 이고, ` +
        `할인율은 ${discB.toFixed(2)}% → ${discC.toFixed(2)}% ` +
        `(${gap >= 0 ? '+' : '△'}${Math.abs(gap).toFixed(2)}%p) 입니다.`,
    });
    if (Math.abs(gap) >= 0.05) {
      out.push({
        kind: 'estimate',
        text:
          `할인율 ${gap > 0 ? '상승' : '하락'}의 원인은 이 데이터로 확인되지 않습니다. ` +
          '실제 할인 정책 변화이거나, 채널·상품 믹스가 바뀌어 지표만 움직인 것으로 추정됩니다.',
      });
    }
  }

  // ③ 원가율 — 금액 증감과 방향이 갈릴 수 있어 따로 짚는다
  if (tagB > 0 && tagC > 0) {
    const rB = ((cogB * 1.13) / tagB) * 100;
    const rC = ((cogC * 1.13) / tagC) * 100;
    const gap = rC - rB;
    out.push({
      kind: 'data',
      text:
        `매출원가는 ${fmt(k(dCogs))} 이고 Tag대비 원가율은 ${rB.toFixed(2)}% → ${rC.toFixed(2)}% ` +
        `(${gap >= 0 ? '+' : '△'}${Math.abs(gap).toFixed(2)}%p) 입니다.`,
    });
    if (Math.abs(gap) >= 0.03) {
      out.push({
        kind: 'estimate',
        text:
          `원가율 ${gap < 0 ? '하락' : '상승'}의 원인은 이 데이터로 확인되지 않습니다. ` +
          '수입과 위탁생산의 비중 변화, 시즌 구성 변화, 매입원가 변동, ' +
          '계획 수립 시 원가율 가정 수정 중 하나로 추정됩니다.',
      });
    }
  }

  // ④ 비용
  if (k(dDirect) !== 0 || k(dOpex) !== 0) {
    out.push({
      kind: 'data',
      text: `직접비 ${fmt(k(dDirect))} · 영업비 ${fmt(k(dOpex))} 이고, 계정별 내역은 아래 칸과 Bridge 막대에서 볼 수 있습니다.`,
    });
  }


  return out;
}
