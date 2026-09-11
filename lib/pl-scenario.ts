// 시나리오(긍정·부정) 계산 — 지난달 보고 대비 모달의 "시나리오" 표
//
// 규칙 (2026-09-11 확정)
//   · 1~기준월은 실적 그대로. 기준월+1 ~ 12월만 시나리오.
//   · YoY 는 남은 달을 합산해 하나로 특정하고(2026 계획 ÷ 2025 실적), ±Δ%p 를 준 뒤
//     현재 계획의 각 달에 같은 배율을 곱한다 — 계획의 월 패턴은 그대로, 합산 YoY 만 정확히 ±Δ.
//       배율 f = (YoY ± Δ) ÷ YoY = 1 ± Δ ÷ YoY
//   · Tag매출  : 직영(ON)·직영(OFF) 각자 YoY ±Δ직영 / 대리상 의류 그대로 / 대리상 ACC YoY ±Δ대리상
//   · 실판(V−) : 직영(ON)·직영(OFF) 각자 YoY ±Δ직영 / 대리상은 Tag 대리상 변동 배율 그대로
//                (ACC 만 움직이고 의류는 고정이므로 할인율이 유지된다)
//   · 매출원가 : 현재 계획의 월별 Tag 대비 원가율 고정 → 원가 × (Tag'/Tag)
//   · 평가감   : 그대로 (분기 재계산 수기값)
//   · 직접비   : 고정비(매장임차료·감가상각비·기타) 그대로. 변동비는 현재 계획의 월별
//                비용율(비용 ÷ 연동 실판) 고정 → 비용 × (연동실판'/연동실판)
//                  급여(매장)·복리후생비(매장)          ← 직영(OFF)
//                  플랫폼수수료·TP수수료·직접광고비     ← 직영(ON)
//                  대리상지원금                         ← 대리상(ON+OFF)
//                  물류비                               ← 전체
//   · 영업비   : 전부 고정
//   · DUVETICA·SUPRA 는 계산하지 않는다 (긍정 = 부정 = 현재)
//   · 2025 실적이 0 이면 그 항목은 배율 1 (현재 그대로)
import type { PLScenarioResponse, ScenarioBrandData, ScenarioIFRS } from '@/app/api/fs/pl/scenario/route';
import { DIRECT_EXPENSE_ITEMS, OPEX_ITEMS } from '@/lib/fs-mapping';
import {
  IFRS_SALES, IFRS_COGS, IFRS_VALUATION, IFRS_SGA, IFRS_OP, IFRS_OP_RATE,
  IFRS_OP_EXCL_INTER, IFRS_OP_EXCL_INTER_RATE, IFRS_INTERCOMPANY_ITEM,
} from '@/lib/ifrs-adjust';

export type ScenarioKey = 'negative' | 'current' | 'positive';

export interface ScenarioParams {
  /** 직영 YoY 에 주는 ±%p (예: 5) */
  directDelta: number;
  /** 대리상 ACC YoY 에 주는 ±%p */
  dealerDelta: number;
}

export const DEFAULT_SCENARIO_PARAMS: ScenarioParams = { directDelta: 5, dealerDelta: 5 };

/** 시나리오를 만들지 않는 브랜드 — 현재 값이 그대로 긍정·부정이 된다 */
const PASSTHROUGH_BRANDS = new Set(['duvetica', 'supra']);

const VAT = 1.13;

/** 직접비 변동비 → 연동 실판 채널. 여기 없는 직접비는 고정비 */
const VARIABLE_DIRECT: Record<string, 'off' | 'on' | 'dealer' | 'all'> = {
  '급여(매장)': 'off',
  '복리후생비(매장)': 'off',
  '플랫폼수수료': 'on',
  'TP수수료': 'on',
  '직접광고비': 'on',
  '대리상지원금': 'dealer',
  '물류비': 'all',
};

/** 표에 나가는 계정 — 손익계산서 본표와 같은 구조 */
export interface ScenarioRowSpec {
  account: string;
  label: string;
  level: number;
  /** 하위 행을 여닫는 부모 */
  isExpandable?: boolean;
  /** 굵게 (이익 계열) */
  isBold?: boolean;
  /** 비율 행 — 기간 합계에서 num ÷ den 으로 계산한다 (법인은 브랜드 비율을 더하면 안 되므로) */
  ratio?: { num: string; den: string };
  /** 손익계산서 본표와 같은 행 배경색 */
  highlight?: 'sky' | 'mint' | 'yellow' | 'orange';
  /** 이 행 아래 굵은 구분선 (본표: 매출총이익 · 영업이익률(관리식)) */
  divider?: boolean;
}

/** 조정 합계 행의 account 키 */
export const IFRS_ADJ_KEY = {
  매출: 'IFRS조정합계|매출',
  매출원가: 'IFRS조정합계|매출원가',
  평가감: 'IFRS조정합계|평가감',
  판관비: 'IFRS조정합계|판관비',
} as const;

export const SCENARIO_ROWS: ScenarioRowSpec[] = [
  { account: 'Tag매출', label: 'Tag매출', level: 0, isExpandable: true, isBold: true, highlight: 'sky' },
  { account: 'Tag매출_대리상(ON)', label: '대리상(ON)', level: 1 },
  { account: 'Tag매출_대리상(OFF)', label: '대리상(OFF)', level: 1 },
  { account: 'Tag매출_직영(ON)', label: '직영(ON)', level: 1 },
  { account: 'Tag매출_직영(OFF)', label: '직영(OFF)', level: 1 },
  { account: '실판매출', label: '실판매출(V−)', level: 0, isExpandable: true, isBold: true, highlight: 'sky' },
  { account: '실판매출_대리상(ON)', label: '대리상(ON)', level: 1 },
  { account: '실판매출_대리상(OFF)', label: '대리상(OFF)', level: 1 },
  { account: '실판매출_직영(ON)', label: '직영(ON)', level: 1 },
  { account: '실판매출_직영(OFF)', label: '직영(OFF)', level: 1 },
  { account: '매출원가 합계', label: '매출원가 합계', level: 0, isExpandable: true, isBold: true },
  { account: '매출원가', label: '매출원가', level: 1 },
  { account: '평가감(설정)', label: '평가감(설정)', level: 1 },
  { account: '평가감(환입)', label: '평가감(환입)', level: 1 },
  { account: '매출총이익', label: '매출총이익', level: 0, isBold: true, highlight: 'mint', divider: true },
  { account: '직접비', label: '직접비', level: 0, isExpandable: true, isBold: true },
  ...DIRECT_EXPENSE_ITEMS.map((a) => ({ account: a, label: a, level: 1 })),
  { account: '영업비', label: '영업비', level: 0, isExpandable: true, isBold: true },
  ...OPEX_ITEMS.map((a) => ({ account: a, label: a, level: 1 })),
  { account: '영업이익(관리식)', label: '영업이익(관리식)', level: 0, isBold: true, highlight: 'mint' },
  { account: '영업이익률(관리식)', label: '영업이익률(관리식)', level: 0, isBold: true, ratio: { num: '영업이익(관리식)', den: '실판매출' }, divider: true },
  // ── (IFRS) 블록 — 조정항목은 시나리오와 무관하게 고정, 합계만 관리식 값을 따라 움직인다 ──
  { account: IFRS_SALES, label: IFRS_SALES, level: 0, isBold: true, isExpandable: true },
  { account: IFRS_ADJ_KEY.매출, label: '조정항목 합계', level: 1 },
  { account: IFRS_COGS, label: IFRS_COGS, level: 0, isBold: true, isExpandable: true },
  { account: IFRS_ADJ_KEY.매출원가, label: '조정항목 합계', level: 1 },
  { account: IFRS_VALUATION, label: IFRS_VALUATION, level: 0, isBold: true, isExpandable: true },
  { account: IFRS_ADJ_KEY.평가감, label: '조정항목 합계', level: 1 },
  { account: IFRS_SGA, label: IFRS_SGA, level: 0, isBold: true, isExpandable: true },
  { account: IFRS_ADJ_KEY.판관비, label: '조정항목 합계', level: 1 },
  { account: IFRS_OP, label: IFRS_OP, level: 0, isBold: true, highlight: 'yellow' },
  { account: IFRS_OP_RATE, label: IFRS_OP_RATE, level: 0, isBold: true, ratio: { num: IFRS_OP, den: IFRS_SALES }, highlight: 'yellow' },
  { account: IFRS_OP_EXCL_INTER, label: IFRS_OP_EXCL_INTER, level: 0, isBold: true, isExpandable: true, highlight: 'orange' },
  { account: IFRS_INTERCOMPANY_ITEM, label: 'Discovery 반품', level: 1 },
  { account: IFRS_OP_EXCL_INTER_RATE, label: IFRS_OP_EXCL_INTER_RATE, level: 0, isBold: true, ratio: { num: IFRS_OP_EXCL_INTER, den: IFRS_SALES }, highlight: 'orange' },
];

/** 계정 → 12개월 (元) */
export type Series = Record<string, number[]>;

const zeros = () => new Array<number>(12).fill(0);
const get = (s: Series, acc: string): number[] => s[acc] ?? zeros();
const add = (...arrs: number[][]): number[] => zeros().map((_, i) => arrs.reduce((t, a) => t + (a[i] ?? 0), 0));
const mul = (a: number[], f: number[]): number[] => a.map((v, i) => v * (f[i] ?? 1));
const sumRange = (a: number[], from: number, to: number): number => {
  let t = 0;
  for (let i = from; i < to; i += 1) t += a[i] ?? 0;
  return t;
};

/** 파생 계정(합계·이익·IFRS)을 채운 전체 시리즈. 비율 행은 여기서 만들지 않는다(합산 후 계산) */
function derive(raw: Series, ifrs?: ScenarioIFRS): Series {
  const out: Series = { ...raw };
  out['매출원가 합계'] = add(get(raw, '매출원가'), get(raw, '평가감(설정)'), get(raw, '평가감(환입)'));
  out['매출총이익'] = get(raw, '실판매출').map((v, i) => v - out['매출원가 합계'][i]);
  out['직접비'] = add(...DIRECT_EXPENSE_ITEMS.map((a) => get(raw, a)));
  out['영업비'] = add(...OPEX_ITEMS.map((a) => get(raw, a)));
  out['영업이익(관리식)'] = out['매출총이익'].map((v, i) => v - out['직접비'][i] - out['영업비'][i]);

  // (IFRS) — 손익계산서 본표(calculatePL)와 같은 산식. 조정은 고정, 관리식 값만 시나리오를 따른다.
  if (ifrs) {
    const 평가감 = add(get(raw, '평가감(설정)'), get(raw, '평가감(환입)'));
    out[IFRS_ADJ_KEY.매출] = [...ifrs.total['매출']];
    out[IFRS_ADJ_KEY.매출원가] = [...ifrs.total['매출원가']];
    out[IFRS_ADJ_KEY.평가감] = [...ifrs.total['평가감']];
    out[IFRS_ADJ_KEY.판관비] = [...ifrs.total['판관비']];
    out[IFRS_SALES] = add(get(raw, '실판매출'), ifrs.total['매출']);
    out[IFRS_COGS] = add(get(raw, '매출원가'), ifrs.total['매출원가']);
    out[IFRS_VALUATION] = add(평가감, ifrs.total['평가감']);
    out[IFRS_SGA] = add(out['직접비'], out['영업비'], ifrs.total['판관비']);
    out[IFRS_OP] = out[IFRS_SALES].map((v, i) => v - out[IFRS_COGS][i] - out[IFRS_VALUATION][i] - out[IFRS_SGA][i]);
    out[IFRS_INTERCOMPANY_ITEM] = [...ifrs.intercompany];
    out[IFRS_OP_EXCL_INTER] = out[IFRS_OP].map((v, i) => v - ifrs.intercompany[i]);
  }
  return out;
}

/**
 * 남은 달 합산 YoY 에 ±Δ%p 를 준 뒤 현재 계획의 각 달에 곱할 배율.
 * 2025 가 0 이거나 2026 계획이 0 이면 1 (건드리지 않는다).
 */
function scale(cur: number[], prev: number[], from: number, deltaPct: number): number[] {
  const c = sumRange(cur, from, 12);
  const p = sumRange(prev, from, 12);
  if (p === 0 || c === 0) return new Array<number>(12).fill(1);
  const yoy = c / p;
  const f = (yoy + deltaPct / 100) / yoy;
  return zeros().map((_, i) => (i < from ? 1 : f));
}

/** 현재 대비 비율(월별). 분모 0 이면 1 */
function ratio(next: number[], cur: number[]): number[] {
  return cur.map((v, i) => (v === 0 ? 1 : (next[i] ?? 0) / v));
}

/**
 * 한 브랜드의 시나리오 한 벌.
 * @param sign +1 긍정, −1 부정, 0 현재
 */
function buildBrandScenario(
  data: ScenarioBrandData,
  baseMonth: number,
  params: ScenarioParams,
  sign: 1 | -1 | 0,
  passthrough: boolean,
): Series {
  const cur = data.current;
  const prev = data.prev;
  if (sign === 0 || passthrough) return derive(cur, data.ifrs);

  const from = baseMonth; // 0-based 인덱스: baseMonth=8 → 9월(인덱스 8)부터
  const dDir = sign * params.directDelta;
  const dDlr = sign * params.dealerDelta;

  const out: Series = { ...cur };

  // ── Tag매출 ──
  const tOn = mul(get(cur, 'Tag매출_직영(ON)'), scale(get(cur, 'Tag매출_직영(ON)'), get(prev, 'Tag매출_직영(ON)'), from, dDir));
  const tOff = mul(get(cur, 'Tag매출_직영(OFF)'), scale(get(cur, 'Tag매출_직영(OFF)'), get(prev, 'Tag매출_직영(OFF)'), from, dDir));
  const tAcc = mul(get(cur, 'Tag매출_대리상_ACC'), scale(get(cur, 'Tag매출_대리상_ACC'), get(prev, 'Tag매출_대리상_ACC'), from, dDlr));
  const tApp = get(cur, 'Tag매출_대리상_APP');
  const tDealerCur = add(get(cur, 'Tag매출_대리상(ON)'), get(cur, 'Tag매출_대리상(OFF)'));
  const tDealerNew = add(tApp, tAcc);
  const dealerRatio = ratio(tDealerNew, tDealerCur);
  out['Tag매출_직영(ON)'] = tOn;
  out['Tag매출_직영(OFF)'] = tOff;
  out['Tag매출_대리상_ACC'] = tAcc;
  out['Tag매출_대리상(ON)'] = mul(get(cur, 'Tag매출_대리상(ON)'), dealerRatio);
  out['Tag매출_대리상(OFF)'] = mul(get(cur, 'Tag매출_대리상(OFF)'), dealerRatio);
  out['Tag매출'] = add(tOn, tOff, out['Tag매출_대리상(ON)'], out['Tag매출_대리상(OFF)']);

  // ── 실판매출 ──
  const sOn = mul(get(cur, '실판매출_직영(ON)'), scale(get(cur, '실판매출_직영(ON)'), get(prev, '실판매출_직영(ON)'), from, dDir));
  const sOff = mul(get(cur, '실판매출_직영(OFF)'), scale(get(cur, '실판매출_직영(OFF)'), get(prev, '실판매출_직영(OFF)'), from, dDir));
  const sDOn = mul(get(cur, '실판매출_대리상(ON)'), dealerRatio);
  const sDOff = mul(get(cur, '실판매출_대리상(OFF)'), dealerRatio);
  out['실판매출_직영(ON)'] = sOn;
  out['실판매출_직영(OFF)'] = sOff;
  out['실판매출_대리상(ON)'] = sDOn;
  out['실판매출_대리상(OFF)'] = sDOff;
  out['실판매출'] = add(sOn, sOff, sDOn, sDOff);

  // ── 매출원가: Tag 대비 원가율 고정 = 원가 × (Tag'/Tag) ──
  out['매출원가'] = mul(get(cur, '매출원가'), ratio(out['Tag매출'], get(cur, 'Tag매출')));

  // ── 직접비 변동비: 비용율 고정 = 비용 × (연동실판'/연동실판) ──
  const linkNew = {
    off: sOff,
    on: sOn,
    dealer: add(sDOn, sDOff),
    all: out['실판매출'],
  };
  const linkCur = {
    off: get(cur, '실판매출_직영(OFF)'),
    on: get(cur, '실판매출_직영(ON)'),
    dealer: add(get(cur, '실판매출_대리상(ON)'), get(cur, '실판매출_대리상(OFF)')),
    all: get(cur, '실판매출'),
  };
  for (const [acc, link] of Object.entries(VARIABLE_DIRECT)) {
    out[acc] = mul(get(cur, acc), ratio(linkNew[link], linkCur[link]));
  }

  return derive(out, data.ifrs);
}

export interface ScenarioResult {
  /** 시나리오 → 계정 → 12개월 (元). 법인이면 브랜드 합산 */
  series: Record<ScenarioKey, Series>;
  /** 2025 실적 — YoY 분모. 법인이면 합산 */
  prev: Series;
  baseMonth: number;
  /** 실제로 시나리오를 만든 브랜드 (DUVETICA·SUPRA 제외) */
  scenarioBrands: string[];
}

export function buildScenarios(data: PLScenarioResponse, params: ScenarioParams): ScenarioResult {
  const keys: ScenarioKey[] = ['negative', 'current', 'positive'];
  const series: Record<ScenarioKey, Series> = { negative: {}, current: {}, positive: {} };
  const prevTotal: Series = {};
  const scenarioBrands: string[] = [];

  for (const [id, bd] of Object.entries(data.brands)) {
    const passthrough = PASSTHROUGH_BRANDS.has(id);
    if (!passthrough) scenarioBrands.push(id);
    for (const key of keys) {
      const sign = key === 'positive' ? 1 : key === 'negative' ? -1 : 0;
      const s = buildBrandScenario(bd, data.baseMonth, params, sign, passthrough);
      for (const [acc, arr] of Object.entries(s)) {
        series[key][acc] = add(series[key][acc] ?? zeros(), arr);
      }
    }
    const p = derive(bd.prev, bd.ifrsPrev);
    for (const [acc, arr] of Object.entries(p)) prevTotal[acc] = add(prevTotal[acc] ?? zeros(), arr);
  }

  return { series, prev: prevTotal, baseMonth: data.baseMonth, scenarioBrands };
}

/** 연간 합 */
export const annual = (arr: number[] | undefined): number => (arr ? arr.reduce((t, v) => t + v, 0) : 0);
