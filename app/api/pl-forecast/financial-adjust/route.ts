import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { readCSV } from '@/lib/csv';
import { createMonthDataMap, getAccountValues } from '@/lib/fs-mapping';

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
    const data = await readCSV(filePath, year);
    const map = createMonthDataMap(data);

    const accounts: Record<string, (number | null)[]> = {};
    for (const acc of ADJUST_ACCOUNTS) {
      accounts[acc] = getAccountValues(map, acc);
    }

    return NextResponse.json({ year, accounts }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // 파일 없으면 빈 데이터 반환
    return NextResponse.json({ year: 2026, accounts: {} }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
