import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { readAdjustCSV } from '@/lib/csv';
import { createMonthDataMap, getAccountValues } from '@/lib/fs-mapping';
import { FinancialData } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADJUST_ACCOUNTS = [
  '사용권자산', '재무비용', '이연수익', '반품충당부채',
  '매출원가조정(credit)', '기타', '리베이트', '정부보조금',
  '매출조정(재무식)',
];

export async function GET(req: NextRequest) {
  try {
    const yearRaw = req.nextUrl.searchParams.get('year') ?? '2026';
    const year = Number(yearRaw);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: '유효한 year 파라미터가 필요합니다.' }, { status: 400 });
    }

    const filePath = path.join(process.cwd(), '파일', '재무조정', `${year}.csv`);
    const { byBrand, total } = await readAdjustCSV(filePath, year);

    // 조정사항별 월배열(accounts) 형태로 변환
    const buildAccounts = (data: FinancialData[]): Record<string, (number | null)[]> => {
      const map = createMonthDataMap(data);
      const accounts: Record<string, (number | null)[]> = {};
      for (const acc of ADJUST_ACCOUNTS) accounts[acc] = getAccountValues(map, acc);
      return accounts;
    };

    // 브랜드별(byBrand) + 법인 합계(total)
    const byBrandAccounts: Record<string, Record<string, (number | null)[]>> = {};
    for (const [brand, data] of Object.entries(byBrand)) {
      byBrandAccounts[brand] = buildAccounts(data);
    }

    return NextResponse.json(
      { year, byBrand: byBrandAccounts, total: buildAccounts(total) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    // 파일 없으면 빈 데이터 반환
    return NextResponse.json({ year: 2026, byBrand: {}, total: {} }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
