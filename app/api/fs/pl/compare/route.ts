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

/** 채널 4개 — 손익계산서와 달리 모달은 묶음 행 없이 부모 바로 아래에 붙인다 */
const channelSpecs = (parent: 'Tag매출' | '실판매출'): CompareRowSpec[] =>
  SALES_CHANNELS.map(ch => ({
    account: channelRowKey(parent, ch), label: ch, level: 1, isReference: true,
  }));

/** 비교 표에 쓰는 행 — 손익계산서 계정명 그대로 */
const COMPARE_ROWS: CompareRowSpec[] = [
  { account: 'Tag매출', level: 0, isChannelParent: true },
  ...channelSpecs('Tag매출'),
  { account: '실판매출', label: '실판매출(V−)', level: 0, isChannelParent: true },
  ...channelSpecs('실판매출'),
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

    const buildRows = async (baseline: boolean) => {
      if (brand === 'all') {
        const byBrand: Record<string, FinancialData[]> = {};
        await Promise.all(
          CORPORATE_PL_BRAND_IDS.map(async (id) => {
            try { byBrand[id] = await readBrand(id, year, baseline); } catch { /* 파일 없으면 제외 */ }
          }),
        );
        return calculatePL(synthesizeCorporatePLFromBrands(byBrand, year), false);
      }
      return calculatePL(await readBrand(brand, year, baseline), true);
    };

    const [currentRows, baselineRows] = await Promise.all([buildRows(false), buildRows(true)]);
    const curMap = new Map(currentRows.map(r => [r.account, r]));
    const baseMap = new Map(baselineRows.map(r => [r.account, r]));

    // 채널 행은 CSV 에 없는 연도/브랜드가 있어 양쪽 다 없으면 아예 내보내지 않는다
    const rows: CompareRow[] = COMPARE_ROWS.flatMap(spec => {
      const cur = curMap.get(spec.account);
      const base = baseMap.get(spec.account);
      if (!cur && !base) return [];
      // 채널 행이 없는 연도/브랜드면 부모를 토글로 만들지 않는다
      const hasChannels = spec.isChannelParent
        && SALES_CHANNELS.some(ch => curMap.has(channelRowKey(spec.account as 'Tag매출' | '실판매출', ch))
          || baseMap.has(channelRowKey(spec.account as 'Tag매출' | '실판매출', ch)));
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
