import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { readCFHierarchyCSV, CFHierarchyRow, readCFPlanData } from '@/lib/csv';

type YearData = Map<string, { total: number; months: number[] }>;

function rowKey(대분류: string, 중분류: string, 소분류: string): string {
  return `${대분류}|${중분류}|${소분류}`;
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

function pathPairForJson(filePath: string): { relative: string; absolute: string } {
  const absolute = path.resolve(filePath).split(path.sep).join('/');
  const relative = path.relative(process.cwd(), filePath).split(path.sep).join('/');
  return { relative, absolute };
}

export interface CFHierarchyApiRow {
  level: 0 | 1 | 2;
  account: string;
  isGroup: boolean;
  values: number[]; // 2026: [전년합계(0), 1~12월(1-12), 당년합계(13), YoY(14), 계획(15), 계획-전년(16), N-1차이금액(17), N-1%(18)]
  대분류?: string;
  중분류?: string;
  소분류?: string;
}

export async function GET(request: NextRequest) {
  try {
    const yearParam = request.nextUrl.searchParams.get('year');
    const currentYear = yearParam ? parseInt(yearParam, 10) : 2026;
    const year = currentYear === 2025 ? 2025 : 2026;
    const prevYear = year === 2025 ? 2024 : 2025;
    const is2025 = year === 2025;

    const baseDir = path.join(process.cwd(), '파일', 'cashflow');

    // 2026년 계획 데이터 로드
    const cfPlanData = (!is2025 && year === 2026)
      ? readCFPlanData(path.join(baseDir, '2026.csv'))
      : null;

    const years = is2025 ? ([2023, 2024, 2025, 2026] as const) : ([2024, 2025, 2026] as const);
    const loaded: { year: number; rows: CFHierarchyRow[] }[] = [];
    const hierarchyCsvSources: { year: number; relative: string; absolute: string }[] = [];

    for (const y of years) {
      const filePath = path.join(baseDir, `${y}.csv`);
      if (!fs.existsSync(filePath)) continue;
      try {
        const data = await readCFHierarchyCSV(filePath, y);
        loaded.push(data);
        hierarchyCsvSources.push({ year: y, ...pathPairForJson(filePath) });
      } catch (e) {
        console.warn(`CF hierarchy ${y} load skip:`, e);
      }
    }

    const planFilePath2026 = path.join(baseDir, '2026.csv');
    const embeddedPlanColumnInFile =
      !is2025 && year === 2026 && cfPlanData !== null ? pathPairForJson(planFilePath2026) : null;

    if (loaded.length === 0) {
      return NextResponse.json({
        rows: [],
        columns: is2025
          ? ['2023년(합계)', '2024년(합계)', '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월', '2025년(합계)', 'YoY']
          : ['2025년(합계)', '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월', '2026년(합계)', 'YoY'],
        hierarchyCsvSources,
        embeddedPlanColumnInFile,
      });
    }

    const latest = loaded.find((x) => x.year === year) ?? loaded.find((x) => x.year === 2026) ?? loaded[loaded.length - 1];
    const dataPrev = buildYearData(loaded.find((x) => x.year === prevYear)?.rows ?? []);
    const dataCurr = buildYearData(loaded.find((x) => x.year === year)?.rows ?? []);
    const data2023 = is2025 ? buildYearData(loaded.find((x) => x.year === 2023)?.rows ?? []) : null;

    // 대분류 순서 유지
    const ordered대분류: string[] = [];
    for (const r of latest.rows) {
      if (r.대분류 && !ordered대분류.includes(r.대분류)) ordered대분류.push(r.대분류);
    }

    // 계층: 대분류 -> 중분류 -> 소분류 (중/소 있는 경우만). 중/소 없으면 대분류 단독 행.
    type Node = { 중분류: string; 소분류: string[] };
    const tree = new Map<string, Node[]>();
    const 대분류Only = new Set<string>(); // 중·소 없이 대분류만 있는 행

    for (const r of latest.rows) {
      const 대 = r.대분류;
      const 중 = (r.중분류 ?? '').trim();
      const 소 = (r.소분류 ?? '').trim();

      if (!중 && !소) {
        대분류Only.add(대);
        continue;
      }
      if (!tree.has(대)) tree.set(대, []);
      const list = tree.get(대)!;
      let node = list.find((n) => n.중분류 === 중);
      if (!node) {
        node = { 중분류: 중, 소분류: [] };
        list.push(node);
      }
      if (소 && !node.소분류.includes(소)) node.소분류.push(소);
    }

    // 2026년에 계획 데이터가 있으면 values에 4개 추가
    // [전년합계, 1~12월, 당년합계, YoY, 전월계획, 계획-전년, 예상-전월계획, 예상-전월계획%]
    const hasPlan = !is2025 && cfPlanData !== null;
    const len = is2025 ? 16 : hasPlan ? 19 : 15;

    const getValues = (
      대: string,
      중: string,
      소: string
    ): number[] => {
      const key = rowKey(대, 중, 소);
      const dPrev = dataPrev.get(key);
      const dCurr = dataCurr.get(key);
      const prevTotal = dPrev?.total ?? 0;
      const currMonths = dCurr?.months ?? new Array(12).fill(0);
      const currTotal = dCurr?.total ?? 0;
      const yoy = currTotal - prevTotal;
      if (is2025 && data2023) {
        const total2023 = data2023.get(key)?.total ?? 0;
        return [total2023, prevTotal, ...currMonths, currTotal, yoy];
      }
      const base = [prevTotal, ...currMonths, currTotal, yoy];
      if (hasPlan && cfPlanData) {
        const planVal = cfPlanData.planData.get(key) ?? 0; // 전월 연간 계획
        // 계획-전년: 전월계획 - 2025년합계
        const planVsPrev = planVal - prevTotal;
        // 예상-전월계획: 당월예상(currTotal) - 전월계획
        const nDiff = currTotal - planVal;
        // %: (예상 - 전월계획) / |전월계획| × 100
        const nPct = planVal !== 0 ? (nDiff / Math.abs(planVal)) * 100 : 0;
        return [...base, planVal, planVsPrev, nDiff, nPct];
      }
      return base;
    };

    const rows: CFHierarchyApiRow[] = [];

    for (const 대분류명 of ordered대분류) {
      if (대분류Only.has(대분류명)) {
        rows.push({
          level: 0,
          account: 대분류명,
          isGroup: false,
          values: getValues(대분류명, '', ''),
          대분류: 대분류명,
        });
        continue;
      }

      const 중목록 = tree.get(대분류명) ?? [];
      const 대분류Values = new Array(len).fill(0);

      rows.push({
        level: 0,
        account: 대분류명,
        isGroup: true,
        values: [...대분류Values],
        대분류: 대분류명,
      });

      for (const { 중분류: 중분류명, 소분류: 소목록 } of 중목록) {
        const 중분류Values = new Array(len).fill(0);

        if (소목록.length === 0) {
          const arr = getValues(대분류명, 중분류명, '');
          for (let i = 0; i < len; i++) {
            중분류Values[i] = arr[i];
            대분류Values[i] += arr[i];
          }
          rows.push({
            level: 1,
            account: 중분류명,
            isGroup: false,
            values: 중분류Values,
            대분류: 대분류명,
            중분류: 중분류명,
          });
        } else {
          rows.push({
            level: 1,
            account: 중분류명,
            isGroup: true,
            values: [...중분류Values],
            대분류: 대분류명,
            중분류: 중분류명,
          });
          for (const 소분류명 of 소목록) {
            const arr = getValues(대분류명, 중분류명, 소분류명);
            for (let i = 0; i < len; i++) {
              중분류Values[i] += arr[i];
              대분류Values[i] += arr[i];
            }
            rows.push({
              level: 2,
              account: 소분류명,
              isGroup: false,
              values: arr,
              대분류: 대분류명,
              중분류: 중분류명,
              소분류: 소분류명,
            });
          }
          const idx = rows.findIndex(
            (r) => r.level === 1 && r.중분류 === 중분류명 && r.isGroup
          );
          if (idx >= 0) rows[idx].values = [...중분류Values];
        }
      }

      const idx = rows.findIndex((r) => r.level === 0 && r.account === 대분류명);
      if (idx >= 0) rows[idx].values = [...대분류Values];
    }

    // net cash: 대분류(level 0) 행들의 컬럼별 합계
    const level0Rows = rows.filter((r) => r.level === 0);
    const netCashValues = new Array(len).fill(0);
    for (const r of level0Rows) {
      for (let i = 0; i < len; i++) netCashValues[i] += r.values[i] ?? 0;
    }
    rows.push({
      level: 0,
      account: 'net cash',
      isGroup: false,
      values: netCashValues,
    });

    const columns = is2025
      ? ['2023년(합계)', '2024년(합계)', '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월', '2025년(합계)', 'YoY']
      : ['2025년(합계)', '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월', '2026년(합계)', 'YoY'];

    return NextResponse.json({
      rows,
      columns,
      hasPlan,
      hierarchyCsvSources,
      embeddedPlanColumnInFile,
    });
  } catch (error) {
    console.error('CF hierarchy API error:', error);
    return NextResponse.json(
      { error: '현금흐름표 계층 데이터를 불러오는데 실패했습니다.' },
      { status: 500 }
    );
  }
}
