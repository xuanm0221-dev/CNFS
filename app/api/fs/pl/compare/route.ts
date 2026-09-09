// 전월대비 — 현재 버전(2026.csv) vs 전월 버전(2026_기존.csv, 지난달 보고본)
//
// 전월 버전 파일은 변경된 브랜드에만 있다 (현재 MLB·DISCOVERY). 파일이 없는 브랜드는
// 계획이 바뀌지 않았다는 뜻이라 현재 파일을 기존 값으로 그대로 쓴다 —
// 그래야 법인 합계 비교가 성립한다.
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { readCSV } from '@/lib/csv';
import {
  calculatePL, synthesizeCorporatePLFromBrands, CORPORATE_PL_BRAND_IDS,
  SALES_CHANNELS, channelRowKey, DIRECT_EXPENSE_ITEMS, OPEX_ITEMS,
  createMonthDataMap, getAccountValues,
} from '@/lib/fs-mapping';
import type { FinancialData } from '@/lib/types';

export const dynamic = 'force-dynamic';

const VALID_BRANDS = ['mlb', 'kids', 'discovery', 'duvetica', 'supra'];

interface CompareRowSpec {
  account: string;
  label?: string;
  level: number;
  /** 채널 분해 행 — 본 계정 계층과 다른 축이라 표시를 구분한다 */
  isReference?: boolean;
  /** 바로 아래 하위 행을 여닫는 부모 (매출 2개 + 비용 3개) */
  isExpandable?: boolean;
}

/**
 * 이 모달에서 쓰는 채널 표기 순서 — 대리상 먼저, 그다음 직영.
 * lib 의 SALES_CHANNELS(직영 먼저)는 손익계산서 본표·현금흐름표가 쓰므로 건드리지 않는다.
 */
const CHANNEL_ORDER = ['대리상(ON)', '대리상(OFF)', '직영(ON)', '직영(OFF)'] as const;

type SalesParent = 'Tag매출' | '실판매출';

/** 매출원가·평가감(환입) 은 채널 4행이 CSV 에 있다. 평가감(설정) 은 원본에 채널이 없어 제외. */
const COST_CHANNEL_PARENTS = ['매출원가', '평가감(환입)'] as const;
const SALES_PARENTS: SalesParent[] = ['Tag매출', '실판매출'];

const BRAND_LABELS: Record<string, string> = {
  mlb: 'MLB',
  kids: 'MLB KIDS',
  discovery: 'DISCOVERY',
  duvetica: 'DUVETICA',
  supra: 'SUPRA',
};

/** 법인 탭에서 Tag매출/실판매출 아래 붙는 브랜드 행의 account 키 */
function brandChildKey(parent: string, brandId: string): string {
  return `${parent}|brand|${brandId}`;
}

/** 브랜드 탭: 채널 4개 — 묶음 행 없이 부모 바로 아래 */
const channelSpecs = (parent: SalesParent): CompareRowSpec[] =>
  CHANNEL_ORDER.map(ch => ({
    account: channelRowKey(parent, ch), label: ch, level: 1, isReference: true,
  }));

/** 법인 탭: 채널 대신 브랜드 5개 — 법인 합계의 구성이 브랜드라 이쪽이 읽기 쉽다 */
const brandSpecs = (parent: SalesParent): CompareRowSpec[] =>
  CORPORATE_PL_BRAND_IDS.map(id => ({
    account: brandChildKey(parent, id), label: BRAND_LABELS[id] ?? id, level: 1, isReference: true,
  }));

/**
 * 비용 계정의 하위 항목 — 손익계산서 표와 같은 계정을 그대로 편다.
 * 매출 쪽(브랜드/채널)과 달리 별도 합성 없이 calculatePL 결과에 이미 들어 있다.
 */
const EXPENSE_CHILDREN: Record<string, readonly string[]> = {
  // 매출원가 합계 = 매출원가 + 평가감(설정) + 평가감(환입). 집계행 '평가감' 은 중복이라 뺀다.
  '매출원가 합계': ['매출원가', '평가감(설정)', '평가감(환입)'],
  '직접비': DIRECT_EXPENSE_ITEMS,
  '영업비': OPEX_ITEMS,
};

/** 매출원가 / 평가감(환입) 아래 붙는 채널 4행 */
const costChannelSpecs = (parent: string): CompareRowSpec[] =>
  CHANNEL_ORDER.map(ch => ({
    account: `${parent}_${ch}`, label: ch, level: 2, isReference: true,
  }));

const hasCostChannels = (acc: string): boolean =>
  (COST_CHANNEL_PARENTS as readonly string[]).includes(acc);

const expenseSpecs = (parent: string): CompareRowSpec[] =>
  EXPENSE_CHILDREN[parent].flatMap(acc =>
    hasCostChannels(acc)
      ? [{ account: acc, label: acc, level: 1, isExpandable: true }, ...costChannelSpecs(acc)]
      : [{ account: acc, label: acc, level: 1 }],
  );

/** 비교 표에 쓰는 행 — 손익계산서 계정명 그대로. 법인이면 하위가 브랜드, 브랜드면 채널. */
const compareRowSpecs = (isCorporate: boolean): CompareRowSpec[] => [
  { account: 'Tag매출', level: 0, isExpandable: true },
  ...(isCorporate ? brandSpecs('Tag매출') : channelSpecs('Tag매출')),
  { account: '실판매출', label: '실판매출(V−)', level: 0, isExpandable: true },
  ...(isCorporate ? brandSpecs('실판매출') : channelSpecs('실판매출')),
  { account: '매출원가 합계', level: 0, isExpandable: true },
  ...expenseSpecs('매출원가 합계'),
  { account: '매출총이익', level: 0 },
  { account: '직접비', level: 0, isExpandable: true },
  ...expenseSpecs('직접비'),
  { account: '영업비', level: 0, isExpandable: true },
  ...expenseSpecs('영업비'),
  { account: '영업이익(관리식)', level: 0 },
];

export interface CompareRow {
  account: string;
  label: string;
  level: number;
  isReference?: boolean;
  /** 하위 행을 여닫는 부모. 하위 데이터가 실제로 있을 때만 true */
  isExpandable?: boolean;
  current: (number | null)[];
  baseline: (number | null)[];
}

/** Bridge 막대를 눌렀을 때 아래에 펼칠 구성 항목 */
export interface BridgeDetailItem {
  label: string;
  current: (number | null)[];
  baseline: (number | null)[];
}

export interface PLCompareResponse {
  year: number;
  brand: string;
  rows: CompareRow[];
  /** 구성 항목 (Bridge 막대 + Tag). 법인이면 브랜드별, 브랜드 탭이면 채널별 */
  bridgeDetails: Record<string, BridgeDetailItem[]>;
  /** 전월 버전 파일이 실제로 있는 브랜드 (없으면 현재 파일로 대체됨) */
  baselineBrands: string[];
}

function brandPath(brand: string, year: number, baseline: boolean): string {
  const name = baseline ? `${year}_기존.csv` : `${year}.csv`;
  return path.join(process.cwd(), '파일', 'PL_brand', brand, name);
}

function hasBaselineFile(brand: string, year: number): boolean {
  return fs.existsSync(brandPath(brand, year, true));
}

/** 전월 버전 파일이 있으면 그것을, 없으면 현재 파일을 읽는다 (= 변경 없음) */
async function readBrand(brand: string, year: number, baseline: boolean): Promise<FinancialData[]> {
  const useBaseline = baseline && hasBaselineFile(brand, year);
  return readCSV(brandPath(brand, year, useBaseline), year);
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const brand = (sp.get('brand') ?? 'all').toLowerCase();
    const year = parseInt(sp.get('year') ?? '2026', 10);

    if (brand !== 'all' && !VALID_BRANDS.includes(brand)) {
      return NextResponse.json({ error: '유효하지 않은 브랜드입니다.' }, { status: 400 });
    }
    if (!Number.isInteger(year)) {
      return NextResponse.json({ error: '유효하지 않은 연도입니다.' }, { status: 400 });
    }

    const isCorporate = brand === 'all';

    // 법인이면 브랜드별 PL 도 같이 만들어 Tag매출·실판매출의 브랜드 분해에 쓴다
    const buildRows = async (baseline: boolean) => {
      if (isCorporate) {
        const byBrand: Record<string, FinancialData[]> = {};
        await Promise.all(
          CORPORATE_PL_BRAND_IDS.map(async (id) => {
            try { byBrand[id] = await readBrand(id, year, baseline); } catch { /* 파일 없으면 제외 */ }
          }),
        );
        const perBrand: Record<string, ReturnType<typeof calculatePL>> = {};
        for (const [id, data] of Object.entries(byBrand)) perBrand[id] = calculatePL(data, true);
        const synth = synthesizeCorporatePLFromBrands(byBrand, year);
        return { rows: calculatePL(synth, false), perBrand, raw: synth };
      }
      const raw = await readBrand(brand, year, baseline);
      return { rows: calculatePL(raw, true), perBrand: {}, raw };
    };

    const [current, baselineData] = await Promise.all([buildRows(false), buildRows(true)]);
    const curMap = new Map(current.rows.map(r => [r.account, r]));
    const baseMap = new Map(baselineData.rows.map(r => [r.account, r]));

    // 법인 탭: 브랜드별 값을 합성 키로 넣는다.
    //   Tag매출·실판매출 → 표의 하위 행
    //   매출원가·평가감   → Bridge 드릴다운 (표에는 안 나온다)
    const BRAND_SPLIT_ACCOUNTS = ['Tag매출', '실판매출', '매출원가', '평가감'] as const;
    if (isCorporate) {
      for (const parent of BRAND_SPLIT_ACCOUNTS) {
        for (const id of CORPORATE_PL_BRAND_IDS) {
          const cur = current.perBrand[id]?.find(r => r.account === parent);
          if (cur) curMap.set(brandChildKey(parent, id), cur);
          const base = baselineData.perBrand[id]?.find(r => r.account === parent);
          if (base) baseMap.set(brandChildKey(parent, id), base);
        }
      }
    }

    // 매출원가·평가감(환입) 의 채널 행은 calculatePL 출력에 없다 (손익계산서 본표에
    // 넣지 않기로 해서). 비교 표에서만 쓰므로 CSV 원본에서 직접 꺼내 맵에 넣는다.
    const injectCostChannels = (raw: FinancialData[], target: Map<string, typeof current.rows[number]>) => {
      const map = createMonthDataMap(raw);
      for (const parent of COST_CHANNEL_PARENTS) {
        for (const ch of SALES_CHANNELS) {
          const key = `${parent}_${ch}`;
          const values = getAccountValues(map, key);
          if (values.every(v => v === 0)) continue; // 데이터 없는 브랜드는 건너뛴다
          target.set(key, { account: key, level: 2, values } as typeof current.rows[number]);
        }
      }
    };
    injectCostChannels(current.raw, curMap);
    injectCostChannels(baselineData.raw, baseMap);

    const specs = compareRowSpecs(isCorporate);

    // 하위 행이 하나도 없으면 부모를 토글로 만들지 않는다
    // (2024 처럼 채널 행이 없는 연도, 브랜드 파일이 없는 경우 등)
    const childAccounts = (parent: string): string[] => {
      if (hasCostChannels(parent)) return CHANNEL_ORDER.map(ch => `${parent}_${ch}`);
      const expense = EXPENSE_CHILDREN[parent];
      if (expense) return [...expense];
      return isCorporate
        ? CORPORATE_PL_BRAND_IDS.map(id => brandChildKey(parent, id))
        : CHANNEL_ORDER.map(ch => channelRowKey(parent as SalesParent, ch));
    };

    // 자식 행이 CSV 에 없으면 아예 내보내지 않는다
    const rows: CompareRow[] = specs.flatMap(spec => {
      const cur = curMap.get(spec.account);
      const base = baseMap.get(spec.account);
      if (!cur && !base) return [];
      const hasChildren = spec.isExpandable
        && childAccounts(spec.account).some(k => curMap.has(k) || baseMap.has(k));
      return [{
        account: spec.account,
        label: spec.label ?? spec.account,
        level: spec.level,
        isReference: spec.isReference,
        isExpandable: hasChildren || undefined,
        current: (cur?.values ?? []).slice(0, 12),
        baseline: (base?.values ?? []).slice(0, 12),
      }];
    });

    // ── Bridge 드릴다운 ──
    // 막대를 누르면 아래에 펼칠 구성 항목. 법인이면 브랜드별, 브랜드면 채널별.
    const pick = (key: string): { current: (number | null)[]; baseline: (number | null)[] } => ({
      current: (curMap.get(key)?.values ?? []).slice(0, 12),
      baseline: (baseMap.get(key)?.values ?? []).slice(0, 12),
    });
    const hasAny = (d: { current: (number | null)[]; baseline: (number | null)[] }) =>
      d.current.some(v => v) || d.baseline.some(v => v);

    const splitBy = (account: string): BridgeDetailItem[] => {
      const list = isCorporate
        ? CORPORATE_PL_BRAND_IDS.map(id => ({
            label: BRAND_LABELS[id] ?? id, ...pick(brandChildKey(account, id)),
          }))
        : CHANNEL_ORDER.map(ch => ({ label: ch, ...pick(`${account}_${ch}`) }));
      return list.filter(hasAny);
    };

    const bridgeDetails: Record<string, BridgeDetailItem[]> = {
      // Tag 는 Bridge 막대가 아니지만, 분석 카드가 같은 구성 데이터를 쓰도록 함께 낸다
      'Tag': splitBy('Tag매출'),
      'V−': splitBy('실판매출'),
      '원가': splitBy('매출원가'),
      // 평가감은 법인이면 브랜드별, 브랜드 탭이면 설정/환입 분해 (채널은 설정 쪽이 없다)
      '평가감': isCorporate
        ? splitBy('평가감')
        : ['평가감(설정)', '평가감(환입)']
            .map(acc => ({ label: acc, ...pick(acc) }))
            .filter(hasAny),
      '직접비': DIRECT_EXPENSE_ITEMS.map(acc => ({ label: acc, ...pick(acc) })).filter(hasAny),
      '영업비': OPEX_ITEMS.map(acc => ({ label: acc, ...pick(acc) })).filter(hasAny),
    };

    const payload: PLCompareResponse = {
      year,
      brand,
      rows,
      bridgeDetails,
      baselineBrands: VALID_BRANDS.filter(b => hasBaselineFile(b, year)),
    };
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('전월대비 API 에러:', error);
    return NextResponse.json({ error: '전월대비 데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}
