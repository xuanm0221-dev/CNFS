import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';

export const runtime = 'nodejs';

type SalesBrand = 'MLB' | 'MLB KIDS' | 'DISCOVERY';
type SalesChannel = 'dealer' | 'direct';

interface BrandActualData {
  tag: Record<SalesChannel, (number | null)[]> & {
    dealerCloth: (number | null)[];
    dealerAcc: (number | null)[];
  };
  sales: Record<SalesChannel, (number | null)[]> & {
    dealerCloth: (number | null)[];
    dealerAcc: (number | null)[];
  };
  accounts: Record<string, (number | null)[]>;
}

interface ActualResponse {
  brands: Record<SalesBrand, BrandActualData>;
  availableMonths: number[];
}

type CsvRow = Record<string, string>;

const BRANDS: SalesBrand[] = ['MLB', 'MLB KIDS', 'DISCOVERY'];

function empty12(): (number | null)[] {
  return new Array(12).fill(null);
}

function makeBrandData(): BrandActualData {
  return {
    tag: { dealer: empty12(), direct: empty12(), dealerCloth: empty12(), dealerAcc: empty12() },
    sales: { dealer: empty12(), direct: empty12(), dealerCloth: empty12(), dealerAcc: empty12() },
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

export async function GET(req: NextRequest) {
  try {
    const yearRaw = req.nextUrl.searchParams.get('year') ?? '2026';
    const year = Number(yearRaw);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: '유효한 year 파라미터가 필요합니다.' }, { status: 400 });
    }

    const dirPath = path.join(process.cwd(), '보조파일(simu)', 'pl_brand_actual_K');
    if (!fs.existsSync(dirPath)) {
      const empty: ActualResponse = {
        brands: { MLB: makeBrandData(), 'MLB KIDS': makeBrandData(), DISCOVERY: makeBrandData() },
        availableMonths: [],
      };
      return NextResponse.json(empty, { headers: { 'Cache-Control': 'no-store' } });
    }

    const files = fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);

    const monthFiles = files
      .map((name) => {
        const m = name.match(/^(\d{4})-(\d{2})\.csv$/i);
        if (!m) return null;
        const y = Number(m[1]);
        const month = Number(m[2]);
        if (y !== year || month < 1 || month > 12) return null;
        return { name, month };
      })
      .filter((v): v is { name: string; month: number } => v !== null)
      .sort((a, b) => a.month - b.month);

    const result: ActualResponse = {
      brands: {
        MLB: makeBrandData(),
        'MLB KIDS': makeBrandData(),
        DISCOVERY: makeBrandData(),
      },
      availableMonths: [],
    };

    for (const file of monthFiles) {
      const monthIdx = file.month - 1;
      result.availableMonths.push(file.month);
      const csvPath = path.join(dirPath, file.name);
      const content = fs.readFileSync(csvPath, 'utf-8');
      const parsed = Papa.parse<CsvRow>(content, { header: true, skipEmptyLines: true });

      for (const row of parsed.data) {
        const level1 = (row.level1 ?? '').trim();
        const level2 = (row.level2 ?? '').trim();
        if (!level1) continue;

        for (const brand of BRANDS) {
          const raw = toNullableNumber(row[brand]);
          if (raw === null) continue;
          const value = raw * 1000; // CSV is CNY K; PL internal uses base CNY.

          if (level1 === 'Tag매출') {
            if (level2 === '대리상') result.brands[brand].tag.dealer[monthIdx] = value;
            if (level2 === '대리상(의류)') result.brands[brand].tag.dealerCloth[monthIdx] = value;
            if (level2 === '대리상(ACC)') result.brands[brand].tag.dealerAcc[monthIdx] = value;
            if (level2 === '직영') result.brands[brand].tag.direct[monthIdx] = value;
            continue;
          }
          if (level1 === '실판매출') {
            if (level2 === '대리상') result.brands[brand].sales.dealer[monthIdx] = value;
            if (level2 === '대리상(의류)') result.brands[brand].sales.dealerCloth[monthIdx] = value;
            if (level2 === '대리상(ACC)') result.brands[brand].sales.dealerAcc[monthIdx] = value;
            if (level2 === '직영') result.brands[brand].sales.direct[monthIdx] = value;
            continue;
          }
          if (level2) continue;

          if (!result.brands[brand].accounts[level1]) {
            result.brands[brand].accounts[level1] = empty12();
          }
          result.brands[brand].accounts[level1][monthIdx] = value;
        }
      }
    }

    // 분리 행(의류+ACC)으로 dealer 합산 재계산
    for (const brand of BRANDS) {
      const bd = result.brands[brand];
      for (let i = 0; i < 12; i++) {
        const tc = bd.tag.dealerCloth[i];
        const ta = bd.tag.dealerAcc[i];
        if (tc !== null || ta !== null) {
          bd.tag.dealer[i] = (tc ?? 0) + (ta ?? 0);
        }
        const sc = bd.sales.dealerCloth[i];
        const sa = bd.sales.dealerAcc[i];
        if (sc !== null || sa !== null) {
          bd.sales.dealer[i] = (sc ?? 0) + (sa ?? 0);
        }
      }
    }

    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `브랜드 실적 CSV 조회 오류: ${message}` }, { status: 500 });
  }
}

