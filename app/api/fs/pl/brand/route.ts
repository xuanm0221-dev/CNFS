import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { readCSV } from '@/lib/csv';
import { calculatePL, calculateComparisonData } from '@/lib/fs-mapping';

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

    // MLB일 때만 재무조정 데이터 반영
    let adjustData: Awaited<ReturnType<typeof readCSV>> | undefined;
    if (brand === 'mlb') {
      const adjustFilePath = path.join(process.cwd(), '파일', '재무조정', `${year}.csv`);
      try { adjustData = await readCSV(adjustFilePath, year); } catch { /* 파일 없으면 무시 */ }
    }

    // 브랜드 모드로 PL 계산
    let tableRows = calculatePL(data, true, adjustData);

    // 2025년인 경우 2024년 대비 비교 데이터 추가
    if (year === 2025) {
      const filePath2024 = path.join(process.cwd(), '파일', 'PL_brand', brand, '2024.csv');
      const data2024 = await readCSV(filePath2024, 2024);
      let adjustData2024: Awaited<ReturnType<typeof readCSV>> | undefined;
      if (brand === 'mlb') {
        const adjustFilePath2024 = path.join(process.cwd(), '파일', '재무조정', '2024.csv');
        try { adjustData2024 = await readCSV(adjustFilePath2024, 2024); } catch { /* 무시 */ }
      }
      const rows2024 = calculatePL(data2024, true, adjustData2024);
      tableRows = calculateComparisonData(tableRows, rows2024, baseMonth);
    }
    // 2026년인 경우 2025년 대비 비교 데이터 추가
    if (year === 2026) {
      const filePath2025 = path.join(process.cwd(), '파일', 'PL_brand', brand, '2025.csv');
      const data2025 = await readCSV(filePath2025, 2025);
      let adjustData2025: Awaited<ReturnType<typeof readCSV>> | undefined;
      if (brand === 'mlb') {
        const adjustFilePath2025 = path.join(process.cwd(), '파일', '재무조정', '2025.csv');
        try { adjustData2025 = await readCSV(adjustFilePath2025, 2025); } catch { /* 무시 */ }
      }
      const rows2025 = calculatePL(data2025, true, adjustData2025);
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
