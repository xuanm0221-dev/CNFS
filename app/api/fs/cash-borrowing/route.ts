import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { readCashBorrowingCSV, readCashBorrowingPlanData } from '@/lib/csv';

export async function GET(request: NextRequest) {
  try {
    const yearParam = request.nextUrl.searchParams.get('year');
    const year = yearParam ? parseInt(yearParam, 10) : 2026;
    const is2025 = year === 2025;

    const baseDir = path.join(process.cwd(), '파일', '현금차입금잔액');
    const result: {
      year: number;
      columns: string[];
      cash: number[];
      borrowing: number[];
      prevCash?: number[];
      prevBorrowing?: number[];
      cashNMonthPlan?: number;
      borrowingNMonthPlan?: number;
    } = {
      year,
      columns: [],
      cash: [],
      borrowing: [],
    };

    const fileCurr = path.join(baseDir, `${year}.csv`);
    if (!fs.existsSync(fileCurr)) {
      return NextResponse.json(result);
    }
    const curr = readCashBorrowingCSV(fileCurr);
    result.cash = curr.현금잔액;
    result.borrowing = curr.차입금잔액;

    if (is2025) {
      result.columns = ['기초잔액', '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월', '기말잔액'];
    } else {
      const filePrev = path.join(baseDir, '2025.csv');
      if (fs.existsSync(filePrev)) {
        const prev = readCashBorrowingCSV(filePrev);
        result.prevCash = prev.현금잔액;
        result.prevBorrowing = prev.차입금잔액;
      }
      // 2026년 계획 데이터 로드 (전월 연간 계획)
      const planData = readCashBorrowingPlanData(fileCurr);
      if (planData) {
        result.cashNMonthPlan = planData.cashPlan;
        result.borrowingNMonthPlan = planData.borrowingPlan;
      }
      result.columns = [
        '2025 기초', '2025 1월', '2025 2월', '2025 3월', '2025 4월', '2025 5월', '2025 6월', '2025 7월', '2025 8월', '2025 9월', '2025 10월', '2025 11월', '2025 12월', '2025 기말',
        '2026 기초', '2026 1월', '2026 2월', '2026 3월', '2026 4월', '2026 5월', '2026 6월', '2026 7월', '2026 8월', '2026 9월', '2026 10월', '2026 11월', '2026 12월', '2026 기말',
      ];
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('cash-borrowing API error:', error);
    return NextResponse.json(
      { error: '현금·차입금 잔액 데이터를 불러오는데 실패했습니다.' },
      { status: 500 }
    );
  }
}
