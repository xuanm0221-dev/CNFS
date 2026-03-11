import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import iconv from 'iconv-lite';
import { FinancialData } from './types';
import { cleanNumericValue, parseMonthColumn } from './utils';

// CSV 파일 읽기 (인코딩 자동 감지)
export async function readCSV(filePath: string, year: number): Promise<FinancialData[]> {
  let content: string;

  try {
    // UTF-8 시도
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    try {
      // CP949(EUC-KR) 시도
      const buffer = fs.readFileSync(filePath);
      content = iconv.decode(buffer, 'cp949');
    } catch (err2) {
      throw new Error(`CSV 파일을 읽을 수 없습니다: ${filePath}`);
    }
  }

  // CSV 파싱
  const parsed = Papa.parse<string[]>(content, {
    header: false,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    console.error('CSV 파싱 에러:', parsed.errors);
  }

  const rows = parsed.data;
  if (rows.length < 2) {
    throw new Error('CSV 파일이 비어있거나 형식이 잘못되었습니다.');
  }

  // 헤더 행 (첫 번째 행)
  const headers = rows[0];
  
  // 월 컬럼 인덱스 찾기
  const monthColumns: { index: number; month: number }[] = [];
  headers.forEach((header, index) => {
    if (index === 0) return; // 첫 번째 컬럼은 "계정과목"
    const month = parseMonthColumn(header);
    if (month !== null) {
      monthColumns.push({ index, month });
    }
  });

  // 데이터 행 파싱
  const result: FinancialData[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const account = row[0]?.trim();
    
    if (!account) continue;

    for (const { index, month } of monthColumns) {
      const valueStr = row[index];
      const value = cleanNumericValue(valueStr || '0');
      
      result.push({
        year,
        month,
        account,
        value,
      });
    }
  }

  // 중복 account+month 합산
  const aggregated = new Map<string, number>();
  for (const item of result) {
    const key = `${item.year}-${item.month}-${item.account}`;
    const current = aggregated.get(key) || 0;
    aggregated.set(key, current + item.value);
  }

  const finalResult: FinancialData[] = [];
  for (const [key, value] of aggregated) {
    const [yearStr, monthStr, account] = key.split('-');
    finalResult.push({
      year: parseInt(yearStr, 10),
      month: parseInt(monthStr, 10),
      account,
      value,
    });
  }

  return finalResult;
}

// 월별 데이터 맵 생성 (account -> [month1, ..., month12])
export function createMonthDataMap(data: FinancialData[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  
  for (const item of data) {
    if (!map.has(item.account)) {
      map.set(item.account, new Array(12).fill(0));
    }
    const values = map.get(item.account)!;
    values[item.month - 1] = item.value;
  }
  
  return map;
}

// 계정 값 가져오기 (없으면 0 배열)
export function getAccountValues(map: Map<string, number[]>, account: string): number[] {
  return map.get(account) || new Array(12).fill(0);
}

// 여러 계정 합산
export function sumAccounts(map: Map<string, number[]>, accounts: string[]): number[] {
  const result = new Array(12).fill(0);
  for (const account of accounts) {
    const values = getAccountValues(map, account);
    for (let i = 0; i < 12; i++) {
      result[i] += values[i];
    }
  }
  return result;
}

// CF 전용 CSV 읽기 (2024년 컬럼 포함)
export async function readCFCSV(filePath: string, year: number): Promise<{ data: FinancialData[], year2024Values: Map<string, number> }> {
  let content: string;

  try {
    // UTF-8 시도
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    try {
      // CP949(EUC-KR) 시도
      const buffer = fs.readFileSync(filePath);
      content = iconv.decode(buffer, 'cp949');
    } catch (err2) {
      throw new Error(`CSV 파일을 읽을 수 없습니다: ${filePath}`);
    }
  }

  // CSV 파싱
  const parsed = Papa.parse<string[]>(content, {
    header: false,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    console.error('CSV 파싱 에러:', parsed.errors);
  }

  const rows = parsed.data;
  if (rows.length < 2) {
    throw new Error('CSV 파일이 비어있거나 형식이 잘못되었습니다.');
  }

  // 헤더 행
  const headers = rows[0];
  
  // 2024년 컬럼 찾기
  let year2024Index = -1;
  headers.forEach((header, index) => {
    if (header.includes('2024')) {
      year2024Index = index;
    }
  });

  // 월 컬럼 인덱스 찾기
  const monthColumns: { index: number; month: number }[] = [];
  headers.forEach((header, index) => {
    if (index === 0) return; // 첫 번째 컬럼은 "계정과목"
    if (index === year2024Index) return; // 2024년 컬럼 제외
    const month = parseMonthColumn(header);
    if (month !== null) {
      monthColumns.push({ index, month });
    }
  });

  // 데이터 행 파싱
  const result: FinancialData[] = [];
  const year2024Values = new Map<string, number>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const account = row[0]?.trim();
    
    if (!account) continue;

    // 2024년 값 저장
    if (year2024Index >= 0) {
      const value2024 = cleanNumericValue(row[year2024Index] || '0');
      year2024Values.set(account, value2024);
    }

    // 월별 값 파싱
    for (const { index, month } of monthColumns) {
      const valueStr = row[index];
      const value = cleanNumericValue(valueStr || '0');
      
      result.push({
        year,
        month,
        account,
        value,
      });
    }
  }

  // 중복 account+month 합산
  const aggregated = new Map<string, number>();
  for (const item of result) {
    const key = `${item.year}-${item.month}-${item.account}`;
    const current = aggregated.get(key) || 0;
    aggregated.set(key, current + item.value);
  }

  const finalResult: FinancialData[] = [];
  for (const [key, value] of aggregated) {
    const [yearStr, monthStr, account] = key.split('-');
    finalResult.push({
      year: parseInt(yearStr, 10),
      month: parseInt(monthStr, 10),
      account,
      value,
    });
  }

  return { data: finalResult, year2024Values };
}

// Credit CSV 읽기 (대리상별 외상매출금, 선수금)
export async function readCreditCSV(filePath: string) {
  let content: string;

  try {
    // UTF-8 시도
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    try {
      // CP949(EUC-KR) 시도
      const buffer = fs.readFileSync(filePath);
      content = iconv.decode(buffer, 'cp949');
    } catch (err2) {
      throw new Error(`CSV 파일을 읽을 수 없습니다: ${filePath}`);
    }
  }

  // CSV 파싱
  const parsed = Papa.parse<string[]>(content, {
    header: false,
    skipEmptyLines: true,
  });

  const rows = parsed.data;
  if (rows.length < 2) {
    throw new Error('CSV 데이터가 부족합니다.');
  }

  // 첫 행은 헤더. 데이터 행: [0]=코드, [1]=중문명, [2]=영문명, [3]=외상매출금, [4]=선수금
  const dealers: Array<{ name: string; 외상매출금: number; 선수금: number }> = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 5) continue;

    const name = (row[2] ?? row[1] ?? row[0])?.trim() || ''; // 영문명 우선, 없으면 중문명·코드
    const 외상매출금Str = row[3]?.trim() || '0';
    const 선수금Str = row[4]?.trim() || '0';

    // 숫자 파싱 (콤마, 공백, 따옴표 제거)
    const parse = (str: string): number => {
      if (!str || str === '-') return 0;
      const cleaned = str.replace(/[",\s]/g, '');
      const num = parseFloat(cleaned);
      return isNaN(num) ? 0 : num;
    };

    dealers.push({
      name,
      외상매출금: parse(외상매출금Str),
      선수금: parse(선수금Str),
    });
  }

  return dealers;
}

// CF 계층 계획 데이터 읽기 (대분류|중분류|소분류 → N-1월 계획값)
// CF 계층 계획 데이터 읽기 ("2026년계획" = 전월 연간 계획)
export function readCFPlanData(filePath: string): {
  planData: Map<string, number>; // "대분류|중분류|소분류" → 전월 연간 계획값
} | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    try {
      const buffer = fs.readFileSync(filePath);
      content = iconv.decode(buffer, 'cp949');
    } catch {
      return null;
    }
  }

  const parsed = Papa.parse<string[]>(content, { header: false, skipEmptyLines: true });
  const rows = parsed.data;
  if (rows.length < 2) return null;

  const headers = rows[0];

  // "YYYY년계획" 패턴 찾기 (예: "2026년계획")
  let planColIndex = -1;
  headers.forEach((header, index) => {
    if (/^\d+년계획$/.test(header.trim())) {
      planColIndex = index;
    }
  });

  if (planColIndex === -1) return null;

  const planData = new Map<string, number>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const 대분류 = (row[0] ?? '').trim();
    const 중분류 = (row[1] ?? '').trim();
    const 소분류 = (row[2] ?? '').trim();
    if (!대분류) continue;
    const key = `${대분류}|${중분류}|${소분류}`;
    const val = cleanNumericValue(row[planColIndex] || '0');
    const existing = planData.get(key) ?? 0;
    planData.set(key, existing + val);
  }

  return { planData };
}

// 현금·차입금잔액 계획 데이터 읽기 ("2026년계획" = 전월 연간 기말잔액 계획)
export function readCashBorrowingPlanData(filePath: string): {
  cashPlan: number;       // 현금 전월 연간 계획
  borrowingPlan: number;  // 차입금 전월 연간 계획
} | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    try {
      const buffer = fs.readFileSync(filePath);
      content = iconv.decode(buffer, 'cp949');
    } catch {
      return null;
    }
  }

  const parsed = Papa.parse<string[]>(content, { header: false, skipEmptyLines: true });
  const rows = parsed.data;
  if (rows.length < 2) return null;

  const headers = rows[0];

  // "YYYY년계획" 패턴 찾기 (예: "2026년계획")
  let planColIndex = -1;
  headers.forEach((header, index) => {
    if (/^\d+년계획$/.test(header.trim())) {
      planColIndex = index;
    }
  });

  if (planColIndex === -1) return null;

  let cashPlan = 0;
  let borrowingPlan = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const label = (row[0] ?? '').trim();
    if (label === '현금잔액') cashPlan = cleanNumericValue(row[planColIndex] || '0');
    else if (label === '차입금잔액') borrowingPlan = cleanNumericValue(row[planColIndex] || '0');
  }

  return { cashPlan, borrowingPlan };
}

// BS 계획 데이터 읽기 (N월계획, YYYY년합계(계획) 컬럼 파싱)
export function readBSPlanData(filePath: string): {
  planMonthValue: Map<string, number>;
  planAnnualValue: Map<string, number>;
  planMonth: number;
} | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    try {
      const buffer = fs.readFileSync(filePath);
      content = iconv.decode(buffer, 'cp949');
    } catch {
      return null;
    }
  }

  const parsed = Papa.parse<string[]>(content, { header: false, skipEmptyLines: true });
  const rows = parsed.data;
  if (rows.length < 2) return null;

  const headers = rows[0];

  // "N월계획" 패턴 찾기 (예: "2월계획")
  let planMonthColIndex = -1;
  let planMonth = -1;
  // "YYYY년합계(계획)" 패턴 찾기 (예: "2026년합계(계획)")
  let planAnnualColIndex = -1;

  headers.forEach((header, index) => {
    const monthPlanMatch = header.trim().match(/^(\d+)월계획$/);
    if (monthPlanMatch) {
      planMonthColIndex = index;
      planMonth = parseInt(monthPlanMatch[1], 10);
    }
    if (/^\d+년합계\(계획\)$/.test(header.trim())) {
      planAnnualColIndex = index;
    }
  });

  if (planMonthColIndex === -1 || planMonth === -1) return null;

  const planMonthValue = new Map<string, number>();
  const planAnnualValue = new Map<string, number>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const account = row[0]?.trim();
    if (!account) continue;
    if (planMonthColIndex >= 0) {
      planMonthValue.set(account, cleanNumericValue(row[planMonthColIndex] || '0'));
    }
    if (planAnnualColIndex >= 0) {
      planAnnualValue.set(account, cleanNumericValue(row[planAnnualColIndex] || '0'));
    }
  }

  return { planMonthValue, planAnnualValue, planMonth };
}

// 현금흐름표 계층형 CSV (대분류, 중분류, 소분류, 1월~12월)
export interface CFHierarchyRow {
  대분류: string;
  중분류: string;
  소분류: string;
  values: number[]; // 1월~12월 순서
}

export async function readCFHierarchyCSV(
  filePath: string,
  year: number
): Promise<{ year: number; rows: CFHierarchyRow[] }> {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    try {
      const buffer = fs.readFileSync(filePath);
      content = iconv.decode(buffer, 'cp949');
    } catch (err2) {
      throw new Error(`CSV 파일을 읽을 수 없습니다: ${filePath}`);
    }
  }

  const parsed = Papa.parse<string[]>(content, {
    header: false,
    skipEmptyLines: true,
  });
  const rows = parsed.data;
  if (rows.length < 2) return { year, rows: [] };

  const headers = rows[0];
  const monthIndices: { month: number; index: number }[] = [];
  for (let i = 3; i < headers.length; i++) {
    const month = parseMonthColumn((headers[i] ?? '').trim());
    if (month !== null) monthIndices.push({ month, index: i });
  }
  monthIndices.sort((a, b) => a.month - b.month);
  if (monthIndices.length === 0) return { year, rows: [] };

  const result: CFHierarchyRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const 대분류 = (row[0] ?? '').trim();
    const 중분류 = (row[1] ?? '').trim();
    const 소분류 = (row[2] ?? '').trim();
    if (!대분류) continue;

    const values = monthIndices.map(({ index }) =>
      cleanNumericValue(row[index] ?? '0')
    );
    result.push({ 대분류, 중분류, 소분류, values });
  }
  return { year, rows: result };
}

// 현금잔액·차입금잔액 CSV (헤더: ,기초잔액, 1월..12월, 기말잔액 / 데이터: 현금잔액, 차입금잔액)
export function readCashBorrowingCSV(filePath: string): { 현금잔액: number[]; 차입금잔액: number[] } {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    try {
      const buffer = fs.readFileSync(filePath);
      content = iconv.decode(buffer, 'cp949');
    } catch (err2) {
      throw new Error(`CSV 파일을 읽을 수 없습니다: ${filePath}`);
    }
  }
  const parsed = Papa.parse<string[]>(content, { header: false, skipEmptyLines: true });
  const rows = parsed.data;
  if (rows.length < 3) return { 현금잔액: [], 차입금잔액: [] };

  const getValues = (row: string[]): number[] => {
    const arr: number[] = [];
    for (let i = 1; i <= 14; i++) arr.push(cleanNumericValue(row[i] ?? '0'));
    return arr;
  };

  let 현금잔액: number[] = [];
  let 차입금잔액: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const label = (row[0] ?? '').trim();
    if (label === '현금잔액') 현금잔액 = getValues(row);
    else if (label === '차입금잔액') 차입금잔액 = getValues(row);
  }
  return { 현금잔액, 차입금잔액 };
}

