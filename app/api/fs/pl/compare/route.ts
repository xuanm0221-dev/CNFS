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
  SALES_CHANNELS, channelRowKey,
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
  /** 바로 아래 채널 행을 여닫는 부모 (Tag매출 / 실판매출) */
  isChannelParent?: boolean;
}

type SalesParent = 'Tag매출' | '실판매출';
const SALES_PARENTS: SalesParent[] = ['Tag매출', '실판매출'];

const BRAND_LABELS: Record<string, string> = {
  mlb: 'MLB',
  kids: 'MLB KIDS',
  discovery: 'DISCOVERY',
  duvetica: 'DUVETICA',
  supra: 'SUPRA',
};

/** 법인 탭에서 Tag매출/실판매출 아래 붙는 브랜드 행의 account 키 */
function brandChildKey(parent: SalesParent, brandId: string): string {
  return `${parent}|brand|${brandId}`;
}

/** 브랜드 탭: 채널 4개 — 묶음 행 없이 부모 바로 아래 */
const channelSpecs = (parent: SalesParent): CompareRowSpec[] =>
  SALES_CHANNELS.map(ch => ({
    account: channelRowKey(parent, ch), label: ch, level: 1, isReference: true,
  }));

/** 법인 탭: 채널 대신 브랜드 5개 — 법인 합계의 구성이 브랜드라 이쪽이 읽기 쉽다 */
const brandSpecs = (parent: SalesParent): CompareRowSpec[] =>
  CORPORATE_PL_BRAND_IDS.map(id => ({
    account: brandChildKey(parent, id), label: BRAND_LABELS[id] ?? id, level: 1, isReference: true,
  }));

/** 비교 표에 쓰는 행 — 손익계산서 계정명 그대로. 법인이면 하위가 브랜드, 브랜드면 채널. */
const compareRowSpecs = (isCorporate: boolean): CompareRowSpec[] => [
  { account: 'Tag매출', level: 0, isChannelParent: true },
  ...(isCorporate ? brandSpecs('Tag매출') : channelSpecs('Tag매출')),
  { account: '실판매출', label: '실판매출(V−)', level: 0, isChannelParent: true },
  ...(isCorporate ? brandSpecs('실판매출') : channelSpecs('실판매출')),
  { account: '매출원가 합계', level: 0 },
  { account: '매출총이익', level: 0 },
  { account: '직접비', level: 0 },
  { account: '영업비', level: 0 },
  { account: '영업이익(관리식)', level: 0 },
];

export interface CompareRow {
  account: string;
  label: string;
  level: number;
  isReference?: boolean;
  /** 채널 행을 여닫는 부모. 채널 데이터가 실제로 있을 때만 true */
  isChannelParent?: boolean;
  current: (number | null)[];
  baseline: (number | null)[];
}

export interface PLCompareResponse {
  year: number;
  brand: string;
  rows: CompareRow[];
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
        return { rows: calculatePL(synthesizeCorporatePLFromBrands(byBrand, year), false), perBrand };
      }
      return { rows: calculatePL(await readBrand(brand, year, baseline), true), perBrand: {} };
    };

    const [current, baselineData] = await Promise.all([buildRows(false), buildRows(true)]);
    const curMap = new Map(current.rows.map(r => [r.account, r]));
    const baseMap = new Map(baselineData.rows.map(r => [r.account, r]));

    // 법인 탭: 브랜드별 Tag매출·실판매출을 합성 키로 넣어 하위 행으로 노출
    if (isCorporate) {
      for (const parent of SALES_PARENTS) {
        for (const id of CORPORATE_PL_BRAND_IDS) {
          const cur = current.perBrand[id]?.find(r => r.account === parent);
          if (cur) curMap.set(brandChildKey(parent, id), cur);
          const base = baselineData.perBrand[id]?.find(r => r.account === parent);
          if (base) baseMap.set(brandChildKey(parent, id), base);
        }
      }
    }

    const specs = compareRowSpecs(isCorporate);

    // 하위 행이 하나도 없으면 부모를 토글로 만들지 않는다
    // (2024 처럼 채널 행이 없는 연도, 브랜드 파일이 없는 경우 등)
    const childAccounts = (parent: string): string[] =>
      isCorporate
        ? CORPORATE_PL_BRAND_IDS.map(id => brandChildKey(parent as SalesParent, id))
        : SALES_CHANNELS.map(ch => channelRowKey(parent as SalesParent, ch));

    // 자식 행이 CSV 에 없으면 아예 내보내지 않는다
    const rows: CompareRow[] = specs.flatMap(spec => {
      const cur = curMap.get(spec.account);
      const base = baseMap.get(spec.account);
      if (!cur && !base) return [];
      const hasChannels = spec.isChannelParent
        && childAccounts(spec.account).some(k => curMap.has(k) || baseMap.has(k));
      return [{
        account: spec.account,
        label: spec.label ?? spec.account,
        level: spec.level,
        isReference: spec.isReference,
        isChannelParent: hasChannels || undefined,
        current: (cur?.values ?? []).slice(0, 12),
        baseline: (base?.values ?? []).slice(0, 12),
      }];
    });

    const payload: PLCompareResponse = {
      year,
      brand,
      rows,
      baselineBrands: VALID_BRANDS.filter(b => hasBaselineFile(b, year)),
    };
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('전월대비 API 에러:', error);
    return NextResponse.json({ error: '전월대비 데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}
