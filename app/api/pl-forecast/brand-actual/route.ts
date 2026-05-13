// PL(sim)용 브랜드 실적 — 파일/PL_brand/{brand}/{year}.csv 단일 소스 사용
// (이전: 보조파일(simu)/pl_brand_actual_K/{YYYY-MM}.csv 월별 천위안)
// 통합 후: 1위안 단위, 1~BASE_MONTH 컬럼만 실적으로 인식, 그 이후는 계획 (null 처리)
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { BASE_MONTH, BASE_YEAR } from '@/lib/base-month';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SalesBrand = 'MLB' | 'MLB KIDS' | 'DISCOVERY' | 'DUVETICA' | 'SUPRA';
type SalesChannel = 'dealer' | 'direct';

interface BrandActualData {
  tag: Record<SalesChannel, (number | null)[]> & {
    dealerCloth: (number | null)[];
    dealerAcc: (number | null)[];
  };
  sales: Record<SalesChannel, (number | null)[]> & {
    dealerCloth: (number | null)[];
    dealerAcc: (number | null)[];
    total: (number | null)[]; // 실적월 단일 합계 (sub-row 분해 없음). 계획월은 null
  };
  retail: Record<SalesChannel, (number | null)[]>;
  accounts: Record<string, (number | null)[]>;
}

interface ActualResponse {
  brands: Record<SalesBrand, BrandActualData>;
  availableMonths: number[];
}

type CsvRow = Record<string, string>;

const BRANDS: SalesBrand[] = ['MLB', 'MLB KIDS', 'DISCOVERY', 'DUVETICA', 'SUPRA'];
const BRAND_TO_DIR: Record<SalesBrand, string> = {
  MLB: 'mlb',
  'MLB KIDS': 'kids',
  DISCOVERY: 'discovery',
  DUVETICA: 'duvetica',
  SUPRA: 'supra',
};
const MONTH_KEYS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

function empty12(): (number | null)[] {
  return new Array(12).fill(null);
}

function makeBrandData(): BrandActualData {
  return {
    tag: { dealer: empty12(), direct: empty12(), dealerCloth: empty12(), dealerAcc: empty12() },
    sales: { dealer: empty12(), direct: empty12(), dealerCloth: empty12(), dealerAcc: empty12(), total: empty12() },
    retail: { dealer: empty12(), direct: empty12() },
    accounts: {},
  };
}

function toNullableNumber(value: string | undefined): number | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function readBrandCsv(year: number, brand: SalesBrand, latestActualMonth: number, bd: BrandActualData) {
  const csvPath = path.join(process.cwd(), '파일', 'PL_brand', BRAND_TO_DIR[brand], `${year}.csv`);
  if (!fs.existsSync(csvPath)) return;
  const content = fs.readFileSync(csvPath, 'utf-8').replace(/^﻿/, '');
  const parsed = Papa.parse<CsvRow>(content, { header: true, skipEmptyLines: true });

  for (const row of parsed.data) {
    const account = (row['계정과목'] ?? '').trim();
    if (!account) continue;

    for (let i = 0; i < 12; i += 1) {
      if (i >= latestActualMonth) continue; // 계획월은 실적에서 제외
      const v = toNullableNumber(row[MONTH_KEYS[i]]);
      if (v === null) continue;

      // PL_brand CSV 계정명 → BrandActualData 필드 매핑
      switch (account) {
        case 'Tag매출_대리상_APP':
          bd.tag.dealerCloth[i] = v;
          break;
        case 'Tag매출_대리상_ACC':
          bd.tag.dealerAcc[i] = v;
          break;
        case 'Tag매출_직영_APP':
        case 'Tag매출_직영_ACC':
          bd.tag.direct[i] = (bd.tag.direct[i] ?? 0) + v;
          break;
        case 'Tag매출':
          // 총합 행 — leaf로 자동 합산되므로 무시
          break;
        case '리테일매출_대리상':
          bd.retail.dealer[i] = v;
          break;
        case '리테일매출_직영':
          bd.retail.direct[i] = v;
          break;
        case '실판매출':
          // PL_brand는 단일 행. 실적월: total에만 저장 (sub-row dealer/direct/dealerCloth/dealerAcc는 null 유지)
          // PL(sim)에서 sales.total[i] !== null이면 그 값을 합계로 사용, sub-row는 표시 안 함
          bd.sales.total[i] = v;
          break;
        default: {
          // 그 외 — 매출원가/평가감/직접비/영업비 등 → accounts[name]
          if (!bd.accounts[account]) bd.accounts[account] = empty12();
          bd.accounts[account][i] = v;
        }
      }
    }
  }

  // tag.dealer = dealerCloth + dealerAcc (분해 행 합산)
  for (let i = 0; i < 12; i += 1) {
    const tc = bd.tag.dealerCloth[i];
    const ta = bd.tag.dealerAcc[i];
    if (tc !== null || ta !== null) bd.tag.dealer[i] = (tc ?? 0) + (ta ?? 0);
  }

}

export async function GET(req: NextRequest) {
  try {
    const yearRaw = req.nextUrl.searchParams.get('year') ?? '2026';
    const year = Number(yearRaw);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: '유효한 year 파라미터가 필요합니다.' }, { status: 400 });
    }

    // 실적월 범위: BASE_YEAR 미만이면 전체 12개월 실적, BASE_YEAR면 BASE_MONTH까지만 실적
    const latestActualMonth = year < BASE_YEAR ? 12 : (year === BASE_YEAR ? BASE_MONTH : 0);

    const result: ActualResponse = {
      brands: {
        MLB: makeBrandData(),
        'MLB KIDS': makeBrandData(),
        DISCOVERY: makeBrandData(),
        DUVETICA: makeBrandData(),
        SUPRA: makeBrandData(),
      },
      availableMonths: Array.from({ length: latestActualMonth }, (_, i) => i + 1),
    };

    for (const brand of BRANDS) {
      readBrandCsv(year, brand, latestActualMonth, result.brands[brand]);
    }

    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `브랜드 실적 CSV 조회 오류: ${message}` }, { status: 500 });
  }
}
