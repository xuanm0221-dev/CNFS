import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { readCSV } from '@/lib/csv';
import { calculatePL, calculateComparisonData } from '@/lib/fs-mapping';
import { loadRetailPLByBrand, makeEmptyRetailPLData } from '@/lib/retail-pl-loader';
import { loadIFRSAdjust, loadLegacyAdjust } from '@/lib/ifrs-adjust-loader';

export const dynamic = 'force-dynamic';

const VALID_BRANDS = ['mlb', 'kids', 'discovery', 'duvetica', 'supra'];

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const brandParam = searchParams.get('brand');
    const yearParam = searchParams.get('year');
    const baseMonthParam = searchParams.get('baseMonth');
    
    // 브랜드 검증
    if (!brandParam || !VALID_BRANDS.includes(brandParam.toLowerCase())) {
      return NextResponse.json(
        { error: '유효하지 않은 브랜드입니다. mlb, kids, discovery, duvetica, supra 중 하나를 선택하세요.' },
        { status: 400 }
      );
    }
    
    const brand = brandParam.toLowerCase();
    const year = yearParam ? parseInt(yearParam, 10) : 2024;
    const baseMonth = baseMonthParam ? parseInt(baseMonthParam, 10) : 11;
    
    if (![2024, 2025, 2026].includes(year)) {
      return NextResponse.json(
        { error: '유효하지 않은 연도입니다. 2024, 2025 또는 2026을 선택하세요.' },
        { status: 400 }
      );
    }
    
    if (baseMonth < 1 || baseMonth > 12) {
      return NextResponse.json(
        { error: '기준월은 1~12 사이여야 합니다.' },
        { status: 400 }
      );
    }
    
    // 브랜드별 CSV 파일 경로
    const filePath = path.join(process.cwd(), '파일', 'PL_brand', brand, `${year}.csv`);
    const data = await readCSV(filePath, year);

    // 구 재무조정 (2024 전용) — 해당 브랜드 행만
    const adjustData = (await loadLegacyAdjust(year))?.byBrand[brand];

    // 리테일매출 (2025/2026만)
    const retailData = (await loadRetailPLByBrand(year, brand)) ?? undefined;

    // 브랜드 모드로 PL 계산
    // IFRS 조정 상세 — 해당 브랜드 행만
    const ifrsAdjust = await loadIFRSAdjust(year, brand);

    let tableRows = calculatePL(data, true, adjustData, retailData, ifrsAdjust);

    // 2025년인 경우 2024년 대비 비교 데이터 추가
    if (year === 2025) {
      const filePath2024 = path.join(process.cwd(), '파일', 'PL_brand', brand, '2024.csv');
      const data2024 = await readCSV(filePath2024, 2024);
      const adjustData2024 = (await loadLegacyAdjust(2024))?.byBrand[brand];
      const rows2024 = calculatePL(data2024, true, adjustData2024, undefined, await loadIFRSAdjust(2024, brand));
      tableRows = calculateComparisonData(tableRows, rows2024, baseMonth);
    }
    // 2026년인 경우 2025년 대비 비교 데이터 추가
    if (year === 2026) {
      const filePath2025 = path.join(process.cwd(), '파일', 'PL_brand', brand, '2025.csv');
      const data2025 = await readCSV(filePath2025, 2025);
      const adjustData2025 = (await loadLegacyAdjust(2025))?.byBrand[brand];
      const retailData2025 = (await loadRetailPLByBrand(2025, brand)) ?? makeEmptyRetailPLData();
      const rows2025 = calculatePL(data2025, true, adjustData2025, retailData2025, await loadIFRSAdjust(2025, brand));
      tableRows = calculateComparisonData(tableRows, rows2025, baseMonth);
    }
    
    return NextResponse.json({
      year,
      type: 'PL',
      brand,
      baseMonth: (year === 2025 || year === 2026) ? baseMonth : undefined,
      rows: tableRows,
    });
  } catch (error) {
    console.error('브랜드 PL API 에러:', error);
    return NextResponse.json(
      { error: '브랜드 PL 데이터를 불러오는데 실패했습니다.' },
      { status: 500 }
    );
  }
}
