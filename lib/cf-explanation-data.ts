import path from 'path';
import fs from 'fs';
import { readCFHierarchyCSV, CFHierarchyRow } from '@/lib/csv';
import { readCashBorrowingCSV } from '@/lib/csv';
import { readCSV } from '@/lib/csv';
import { calculateWorkingCapital, calculateComparisonDataBS } from '@/lib/fs-mapping';

type YearData = Map<string, { total: number; months: number[] }>;

function rowKey(대: string, 중: string, 소: string): string {
  return `${대}|${중}|${소}`;
}

function buildYearData(rows: CFHierarchyRow[]): YearData {
  const map = new Map<string, { total: number; months: number[] }>();
  for (const r of rows) {
    const key = rowKey(r.대분류, r.중분류, r.소분류);
    const total = r.values.reduce((a, b) => a + b, 0);
    map.set(key, { total, months: r.values });
  }
  return map;
}

export interface CFExplanationNumbers {
  // 현금흐름 (원 단위)
  영업활동_25: number;
  영업활동_26: number;
  영업활동_yoy: number;
  매출수금_yoy: number;
  물품대_yoy: number;
  자산성지출_26: number;
  자산성지출_yoy: number;
  기타수익_26: number;
  기타수익_yoy: number;
  차입금_26: number;
  차입금_yoy: number;
  netCash_26: number;
  netCash_yoy: number;
  // 현금·차입금 잔액 (기말)
  차입금_기말_25: number;
  차입금_기말_26: number;
  차입금_기말_yoy: number;
  // 운전자본 (원 단위, 25/26 기말 및 YoY)
  운전자본_25: number;
  운전자본_26: number;
  운전자본_yoy: number;
  매출채권_25: number;
  매출채권_26: number;
  매출채권_yoy: number;
  재고자산_25: number;
  재고자산_26: number;
  재고자산_yoy: number;
  매입채무_25: number;
  매입채무_26: number;
  매입채무_yoy: number;
  대리상AR_26: number;
  대리상AR_yoy: number;
}

const ZERO: CFExplanationNumbers = {
  영업활동_25: 0,
  영업활동_26: 0,
  영업활동_yoy: 0,
  매출수금_yoy: 0,
  물품대_yoy: 0,
  자산성지출_26: 0,
  자산성지출_yoy: 0,
  기타수익_26: 0,
  기타수익_yoy: 0,
  차입금_26: 0,
  차입금_yoy: 0,
  netCash_26: 0,
  netCash_yoy: 0,
  차입금_기말_25: 0,
  차입금_기말_26: 0,
  차입금_기말_yoy: 0,
  운전자본_25: 0,
  운전자본_26: 0,
  운전자본_yoy: 0,
  매출채권_25: 0,
  매출채권_26: 0,
  매출채권_yoy: 0,
  재고자산_25: 0,
  재고자산_26: 0,
  재고자산_yoy: 0,
  매입채무_25: 0,
  매입채무_26: 0,
  매입채무_yoy: 0,
  대리상AR_26: 0,
  대리상AR_yoy: 0,
};

export async function getCFExplanationSummaryNumbers(): Promise<CFExplanationNumbers> {
  const baseDir = path.join(process.cwd(), '파일');
  const result = { ...ZERO };

  // 1) CF hierarchy 2025, 2026
  const cashflowDir = path.join(baseDir, 'cashflow');
  const cf2025Path = path.join(cashflowDir, '2025.csv');
  const cf2026Path = path.join(cashflowDir, '2026.csv');
  if (fs.existsSync(cf2026Path)) {
    const [data2025, data2026] = await Promise.all([
      fs.existsSync(cf2025Path) ? readCFHierarchyCSV(cf2025Path, 2025) : { year: 2025, rows: [] as CFHierarchyRow[] },
      readCFHierarchyCSV(cf2026Path, 2026),
    ]);
    const dataPrev = buildYearData(data2025.rows);
    const dataCurr = buildYearData(data2026.rows);
    const 대분류Set = new Set(data2026.rows.map((r) => r.대분류));

    for (const 대 of 대분류Set) {
      let curr = 0,
        prev = 0;
      for (const r of data2026.rows) {
        if (r.대분류 !== 대) continue;
        const key = rowKey(r.대분류, r.중분류, r.소분류);
        curr += dataCurr.get(key)?.total ?? 0;
        prev += dataPrev.get(key)?.total ?? 0;
      }
      const yoy = curr - prev;
      if (대 === '영업활동') {
        result.영업활동_25 = prev;
        result.영업활동_26 = curr;
        result.영업활동_yoy = yoy;
        // 영업활동 중분류별 YoY 집계
        for (const 중 of ['매출수금', '물품대']) {
          let cSub = 0, pSub = 0;
          for (const r of data2026.rows) {
            if (r.대분류 !== '영업활동' || r.중분류 !== 중) continue;
            const k = rowKey(r.대분류, r.중분류, r.소분류);
            cSub += dataCurr.get(k)?.total ?? 0;
            pSub += dataPrev.get(k)?.total ?? 0;
          }
          if (중 === '매출수금') result.매출수금_yoy = cSub - pSub;
          if (중 === '물품대') result.물품대_yoy = cSub - pSub;
        }
      } else if (대 === '자산성지출') {
        result.자산성지출_26 = curr;
        result.자산성지출_yoy = yoy;
      } else if (대 === '기타수익') {
        result.기타수익_26 = curr;
        result.기타수익_yoy = yoy;
      } else if (대 === '차입금') {
        result.차입금_26 = curr;
        result.차입금_yoy = yoy;
      }
    }
    // net cash = sum of all 대분류
    let netCurr = 0,
      netPrev = 0;
    for (const 대 of 대분류Set) {
      let curr = 0,
        prev = 0;
      for (const r of data2026.rows) {
        if (r.대분류 !== 대) continue;
        const key = rowKey(r.대분류, r.중분류, r.소분류);
        curr += dataCurr.get(key)?.total ?? 0;
        prev += dataPrev.get(key)?.total ?? 0;
      }
      netCurr += curr;
      netPrev += prev;
    }
    result.netCash_26 = netCurr;
    result.netCash_yoy = netCurr - netPrev;
  }

  // 2) Cash / Borrowing balance
  const cbDir = path.join(baseDir, '현금차입금잔액');
  const cb2026Path = path.join(cbDir, '2026.csv');
  const cb2025Path = path.join(cbDir, '2025.csv');
  if (fs.existsSync(cb2026Path)) {
    const curr = readCashBorrowingCSV(cb2026Path);
    const prev = fs.existsSync(cb2025Path) ? readCashBorrowingCSV(cb2025Path) : { 현금잔액: [], 차입금잔액: [] };
    // 기말 = index 13 (0-based, 14번째: 기초,1..12,기말)
    const 기말 = (arr: number[]) => (arr.length > 13 ? arr[13] : 0);
    result.차입금_기말_26 = 기말(curr.차입금잔액);
    result.차입금_기말_25 = 기말(prev.차입금잔액);
    result.차입금_기말_yoy = result.차입금_기말_26 - result.차입금_기말_25;
  }

  // 3) BS Working capital (25 vs 26)
  const bsDir = path.join(baseDir, 'BS');
  const bs2026Path = path.join(bsDir, '2026.csv');
  const bs2025Path = path.join(bsDir, '2025.csv');
  if (fs.existsSync(bs2026Path)) {
    const data2026 = await readCSV(bs2026Path, 2026);
    const data2025 = fs.existsSync(bs2025Path) ? await readCSV(bs2025Path, 2025) : [];
    const wc2026 = calculateWorkingCapital(data2026);
    const wc2025 = calculateWorkingCapital(data2025);
    const wc2026WithCompare = calculateComparisonDataBS(wc2026, wc2025, 2026);

    const get = (account: string) => wc2026WithCompare.find((r) => r.account === account);
    const v = (row: { values?: (number | null)[]; comparisons?: { prevYearAnnual: number | null; currYearAnnual: number | null; annualYoY: number | null } } | undefined) =>
      row?.comparisons?.currYearAnnual ?? row?.values?.[11] ?? 0;
    const p = (row: ReturnType<typeof get>) => row?.comparisons?.prevYearAnnual ?? row?.values?.[11] ?? 0;
    const y = (row: ReturnType<typeof get>) => row?.comparisons?.annualYoY ?? 0;

    result.운전자본_26 = v(get('운전자본'));
    result.운전자본_25 = p(get('운전자본'));
    result.운전자본_yoy = y(get('운전자본'));
    result.매출채권_26 = v(get('외상매출금'));
    result.매출채권_25 = p(get('외상매출금'));
    result.매출채권_yoy = y(get('외상매출금'));
    result.재고자산_26 = v(get('재고자산'));
    result.재고자산_25 = p(get('재고자산'));
    result.재고자산_yoy = y(get('재고자산'));
    // 매입채무: 외상매입금 (values are negative for AP)
    result.매입채무_26 = v(get('외상매입금'));
    result.매입채무_25 = p(get('외상매입금'));
    result.매입채무_yoy = y(get('외상매입금'));
    result.대리상AR_26 = v(get('대리상AR'));
    result.대리상AR_yoy = y(get('대리상AR'));
  }

  return result;
}
