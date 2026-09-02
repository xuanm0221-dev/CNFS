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
  SALES_CHANNELS, channelGroupKey, channelRowKey,
} from '@/lib/fs-mapping';
import type { FinancialData } from '@/lib/types';

export const dynamic = 'force-dynamic';

const VALID_BRANDS = ['mlb', 'kids', 'discovery', 'duvetica', 'supra'];

interface CompareRowSpec {
  account: string;
  label?: string;
  level: number;
  /** 채널별 보기 — 본 계정 계층과 다른 분해축 (표시만 구분) */
  isReference?: boolean;
}

/** 채널별 보기 묶음 + 4채널 (손익계산서와 같은 구조) */
const channelSpecs = (parent: 'Tag매출' | '실판매출'): CompareRowSpec[] => [
  { account: channelGroupKey(parent), label: '채널별 보기 (참고)', level: 1, isReference: true },
  ...SALES_CHANNELS.map(ch => ({
    account: channelRowKey(parent, ch), label: ch, level: 2, isReference: true,
  })),
];

/** 비교 표에 쓰는 행 — 손익계산서 계정명 그대로 */
const COMPARE_ROWS: CompareRowSpec[] = [
  { account: 'Tag매출', level: 0 },
  ...channelSpecs('Tag매출'),
  { account: '실판매출', label: '실판매출(V−)', level: 0 },
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
      return [{
        account: spec.account,
        label: spec.label ?? spec.account,
        level: spec.level,
        isReference: spec.isReference,
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
