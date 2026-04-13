import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { readCSV, readCFHierarchyCSV, CFHierarchyRow } from '@/lib/csv';
import { calculatePL, calculateBS, calculateWorkingCapital } from '@/lib/fs-mapping';
import { ExecutiveSummaryData, TableRow } from '@/lib/types';

function rowKey(대: string, 중: string, 소: string): string {
  return `${대}|${중}|${소}`;
}

function buildCFYearData(rows: CFHierarchyRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = rowKey(r.대분류, r.중분류, r.소분류);
    const total = r.values.reduce((a, b) => a + b, 0);
    map.set(key, total);
  }
  return map;
}

// 값 가져오기 헬퍼 함수 (특정 월)
function getValue(data: TableRow[], account: string, monthIndex: number): number {
  const row = data.find(r => r.account === account);
  return row?.values[monthIndex] ?? 0;
}

// 연간 합계 (1~12월, 손익계산서 수익성분석용)
function getValueAnnual(data: TableRow[], account: string): number {
  const row = data.find(r => r.account === account);
  if (!row?.values?.length) return 0;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += row.values[i] ?? 0;
  }
  return sum;
}

// 경영요약 자동 생성 함수 (2025년 기말 vs 2026년 기말)
function generateSummary(
  pl2025: TableRow[],
  pl2026: TableRow[],
  bs2025: TableRow[],
  bs2026: TableRow[],
  영업활동YoY: number = 0,
  운전자본YoY: number = 0
): ExecutiveSummaryData {
  
  const month = 11; // 12월 기말 (index 11) - 재무상태표(BS)·브랜드 등 기말 기준

  // PL 데이터 추출 - 수익성분석/비용증가: 손익계산서 연간 합계 (25년 연간 vs 26년 연간)
  const tag매출25 = getValueAnnual(pl2025, 'Tag매출');
  const tag매출26 = getValueAnnual(pl2026, 'Tag매출');
  const 실판매출25 = getValueAnnual(pl2025, '실판매출');
  const 실판매출26 = getValueAnnual(pl2026, '실판매출');
  const 매출총이익25 = getValueAnnual(pl2025, '매출총이익');
  const 매출총이익26 = getValueAnnual(pl2026, '매출총이익');
  const 영업이익25 = getValueAnnual(pl2025, '영업이익(관리식)');
  const 영업이익26 = getValueAnnual(pl2026, '영업이익(관리식)');
  const 직접비25 = getValueAnnual(pl2025, '직접비');
  const 직접비26 = getValueAnnual(pl2026, '직접비');
  const 영업비25 = getValueAnnual(pl2025, '영업비');
  const 영업비26 = getValueAnnual(pl2026, '영업비');
  const 광고비25 = getValueAnnual(pl2025, '광고비');
  const 광고비26 = getValueAnnual(pl2026, '광고비');
  const 매출원가25 = getValueAnnual(pl2025, '매출원가');
  const 매출원가26 = getValueAnnual(pl2026, '매출원가');
  // 영업이익률: 연간 합계 기준으로 계산
  const 영업이익률25 = 실판매출25 !== 0 ? (영업이익25 / 실판매출25) * 100 : 0;
  const 영업이익률26 = 실판매출26 !== 0 ? (영업이익26 / 실판매출26) * 100 : 0;
  
  // BS 데이터 추출 (12월 기말 기준, K 단위)
  const 자산25 = getValue(bs2025, '자산', month);
  const 자산26 = getValue(bs2026, '자산', month);
  const 부채25 = getValue(bs2025, '부채', month);
  const 부채26 = getValue(bs2026, '부채', month);
  const 자본25 = getValue(bs2025, '자본', month);
  const 자본26 = getValue(bs2026, '자본', month);
  const 유동자산25 = getValue(bs2025, '유동자산', month);
  const 유동자산26 = getValue(bs2026, '유동자산', month);
  const 유동부채25 = getValue(bs2025, '유동부채', month);
  const 유동부채26 = getValue(bs2026, '유동부채', month);
  const 이익잉여금25 = getValue(bs2025, '이익잉여금', month);
  const 이익잉여금26 = getValue(bs2026, '이익잉여금', month);
  const 재고25 = getValue(bs2025, '재고자산', month);
  const 재고26 = getValue(bs2026, '재고자산', month);
  const 직영AR25 = getValue(bs2025, '직영AR', month);
  const 대리상AR25 = getValue(bs2025, '대리상AR', month);
  const AR25 = 직영AR25 + 대리상AR25;
  const 직영AR26 = getValue(bs2026, '직영AR', month);
  const 대리상AR26 = getValue(bs2026, '대리상AR', month);
  const AR26 = 직영AR26 + 대리상AR26;
  const 차입금25 = getValue(bs2025, '차입금', month);
  const 차입금26 = getValue(bs2026, '차입금', month);
  const 본사AP25 = getValue(bs2025, '본사 AP', month);
  const 제품AP25 = getValue(bs2025, '제품 AP', month);
  const 본사AP26 = getValue(bs2026, '본사 AP', month);
  const 제품AP26 = getValue(bs2026, '제품 AP', month);
  const 외상매입채무25 = Math.abs(본사AP25) + Math.abs(제품AP25);
  const 외상매입채무26 = Math.abs(본사AP26) + Math.abs(제품AP26);

  // 계산 (25년 → 26년)
  const tag매출증가율 = tag매출25 !== 0 ? ((tag매출26 - tag매출25) / tag매출25) * 100 : 0;
  const 실판매출증가율 = 실판매출25 !== 0 ? ((실판매출26 - 실판매출25) / 실판매출25) * 100 : 0;
  const 영업이익증가율 = 영업이익25 !== 0 ? ((영업이익26 - 영업이익25) / Math.abs(영업이익25)) * 100 : 0;
  
  const 영업이익상태 =
    영업이익25 < 0 && 영업이익26 > 0 ? '흑자전환' :
    영업이익25 > 0 && 영업이익26 < 0 ? '적자전환' :
    null;
  
  const 직접비증가율 = 직접비25 !== 0 ? ((직접비26 - 직접비25) / 직접비25) * 100 : 0;
  const 영업비증가율 = 영업비25 !== 0 ? ((영업비26 - 영업비25) / 영업비25) * 100 : 0;
  const 광고비증가율 = 광고비25 !== 0 ? ((광고비26 - 광고비25) / 광고비25) * 100 : 0;
  const 자산증가율 = 자산25 !== 0 ? ((자산26 - 자산25) / 자산25) * 100 : 0;
  const 부채증가율 = 부채25 !== 0 ? ((부채26 - 부채25) / 부채25) * 100 : 0;
  const 자본증가율 = 자본25 !== 0 ? ((자본26 - 자본25) / 자본25) * 100 : 0;
  const 재고증가율 = 재고25 !== 0 ? ((재고26 - 재고25) / 재고25) * 100 : 0;
  const AR증가율 = AR25 !== 0 ? ((AR26 - AR25) / AR25) * 100 : 0;
  const 부채비율25 = 자본25 !== 0 ? (부채25 / 자본25) * 100 : 0;
  const 부채비율26 = 자본26 !== 0 ? (부채26 / 자본26) * 100 : 0;
  const 차입금비율25 = 자본25 !== 0 ? (차입금25 / 자본25) * 100 : 0;
  const 차입금비율26 = 자본26 !== 0 ? (차입금26 / 자본26) * 100 : 0;

  // 당기순이익 (이익잉여금 YoY 차이)
  const 당기순이익26 = 이익잉여금26 - 이익잉여금25;
  
  const ROE26 = 자본26 !== 0 ? (당기순이익26 / 자본26) * 100 : 0;
  const ROA26 = 자산26 !== 0 ? (당기순이익26 / 자산26) * 100 : 0;
  
  const 유동비율25 = 유동부채25 !== 0 ? (유동자산25 / 유동부채25) * 100 : 0;
  const 유동비율26 = 유동부채26 !== 0 ? (유동자산26 / 유동부채26) * 100 : 0;
  
  const 매출총이익률25 = 실판매출25 !== 0 ? (매출총이익25 / 실판매출25) * 100 : 0;
  const 매출총이익률26 = 실판매출26 !== 0 ? (매출총이익26 / 실판매출26) * 100 : 0;
  
  // K 단위로 콤마 포맷팅 (1위안 단위 → K 단위 변환)
  const toKWithComma = (val: number) => {
    return Math.round(val / 1000).toLocaleString('ko-KR');
  };
  
  // M 단위로 변환 (K / 1000) - 재무현황 등에서 사용하지 않으므로 제거 가능하지만 일단 유지
  const toM = (val: number) => Math.round(val / 1000);
  // 백만원(M) 단위 (원 -> M)
  const toMillion = (val: number) => Math.round(val / 1_000_000);
  const 영업현금흐름M = toMillion(영업활동YoY);
  const 재고감축M = 재고25 > 재고26 ? toMillion(재고25 - 재고26) : 0;
  const 운전자본효율화M = toMillion(운전자본YoY);

  // DIO = (재고자산/매출원가)*365, DSO = (외상매출금/매출액)*365, DPO = (외상매입채무/매출원가)*365, CCC = DSO+DIO-DPO (기말 잔액 + 연간 발생액)
  const DIO25 = 매출원가25 !== 0 ? (재고25 / 매출원가25) * 365 : 0;
  const DIO26 = 매출원가26 !== 0 ? (재고26 / 매출원가26) * 365 : 0;
  const DSO25 = 실판매출25 !== 0 ? (AR25 / 실판매출25) * 365 : 0;
  const DSO26 = 실판매출26 !== 0 ? (AR26 / 실판매출26) * 365 : 0;
  const DPO25 = 매출원가25 !== 0 ? (외상매입채무25 / 매출원가25) * 365 : 0;
  const DPO26 = 매출원가26 !== 0 ? (외상매입채무26 / 매출원가26) * 365 : 0;
  const CCC25 = DSO25 + DIO25 - DPO25;
  const CCC26 = DSO26 + DIO26 - DPO26;
  const DIO단축일수 = Math.round(DIO25 - DIO26);
  const DSO단축일수 = Math.round(DSO25 - DSO26);
  const CCC단축일수 = Math.round(CCC25 - CCC26);
  const CCC개선율 = CCC25 !== 0 ? ((CCC25 - CCC26) / CCC25) * 100 : 0;

  // 차입금 감소율·부채 감소율·자본 증가율 (0 나눗셈 처리)
  const 차입금감소율 = 차입금25 !== 0 ? ((차입금25 - 차입금26) / 차입금25) * 100 : 0;
  const 부채감소율 = 부채25 !== 0 ? ((부채25 - 부채26) / 부채25) * 100 : 0;
  const 매출총이익YoY = 매출총이익26 - 매출총이익25;
  const 영업비YoY = 영업비26 - 영업비25;
  const 부채비율개선p = 부채비율25 - 부채비율26;
  const 영업이익률개선p = 영업이익률26 - 영업이익률25;
  const 매출총이익률개선p = 매출총이익률26 - 매출총이익률25;
  const 영업비YoY감소율 = 영업비25 !== 0 ? ((영업비25 - 영업비26) / 영업비25) * 100 : 0;

  return {
    title: 'F&F CHINA 2026 재무 성과 종합 분석 (2026년 기말 기준)',
    baseMonth: 12,
    sections: {
      수익성분석: {
        매출성장: [
          `• Tag매출 25년 ${toKWithComma(tag매출25)}K → 26년 ${toKWithComma(tag매출26)}K (${tag매출증가율 > 0 ? '+' : ''}${tag매출증가율.toFixed(1)}%)`,
          `• 실판매출 ${toKWithComma(실판매출25)}K → ${toKWithComma(실판매출26)}K (${실판매출증가율 > 0 ? '+' : '△'}${Math.abs(실판매출증가율).toFixed(1)}%)`,
          `• 영업이익 ${toKWithComma(영업이익25)}K → ${toKWithComma(영업이익26)}K (${영업이익상태 || `${영업이익증가율 > 0 ? '+' : '△'}${Math.abs(영업이익증가율).toFixed(1)}%`})`,
          `• 영업이익률 ${영업이익률25.toFixed(1)}% → ${영업이익률26.toFixed(1)}% (${(영업이익률26 - 영업이익률25) > 0 ? '+' : '△'}${Math.abs(영업이익률26 - 영업이익률25).toFixed(1)}%p)`
        ],
        비용증가: [
          `• 직접비 ${toKWithComma(직접비25)}K → ${toKWithComma(직접비26)}K (${직접비증가율 >= 0 ? '+' : '△'}${Math.abs(직접비증가율).toFixed(1)}%)`,
          `• 영업비 ${toKWithComma(영업비25)}K → ${toKWithComma(영업비26)}K (${영업비증가율 >= 0 ? '+' : '△'}${Math.abs(영업비증가율).toFixed(1)}%)`,
          `• 광고비 ${toKWithComma(광고비25)}K → ${toKWithComma(광고비26)}K (${광고비증가율 >= 0 ? '+' : '△'}${Math.abs(광고비증가율).toFixed(0)}%)`
        ]
      },
      재무현황: {
        자산규모: [
          `• 총자산: ${toKWithComma(자산25)}K → ${toKWithComma(자산26)}K (${자산26 - 자산25 >= 0 ? '+' : '△'}${toKWithComma(Math.abs(자산26 - 자산25))}K, ${자산증가율 >= 0 ? '+' : '△'}${Math.abs(자산증가율).toFixed(1)}%)`,
          `• 현금: ${toKWithComma(getValue(bs2025, '현금 및 현금성자산', month))}K → ${toKWithComma(getValue(bs2026, '현금 및 현금성자산', month))}K`
        ],
        부채증가: [
          `• 부채: ${toKWithComma(부채25)}K → ${toKWithComma(부채26)}K (${부채증가율 > 0 ? '+' : '△'}${toKWithComma(Math.abs(부채26 - 부채25))}K, ${부채증가율 > 0 ? '+' : '△'}${Math.abs(부채증가율).toFixed(1)}%)`,
          `• 차입금: ${toKWithComma(차입금25)}K → ${toKWithComma(차입금26)}K`
        ],
        재고자산: [
          `• 재고: ${toKWithComma(재고25)}K → ${toKWithComma(재고26)}K (${재고26 - 재고25 >= 0 ? '+' : '△'}${toKWithComma(Math.abs(재고26 - 재고25))}K, ${재고증가율 >= 0 ? '+' : '△'}${Math.abs(재고증가율).toFixed(1)}%)`,
          `• 외상매출금: ${toKWithComma(AR25)}K → ${toKWithComma(AR26)}K (${AR26 - AR25 >= 0 ? '+' : '△'}${toKWithComma(Math.abs(AR26 - AR25))}K, ${AR증가율 >= 0 ? '+' : '△'}${Math.abs(AR증가율).toFixed(1)}%)`
        ],
        자본안정: [
          `• 총자본: ${toKWithComma(자본25)}K → ${toKWithComma(자본26)}K (${자본26 - 자본25 >= 0 ? '+' : '△'}${toKWithComma(Math.abs(자본26 - 자본25))}K, ${자본증가율 >= 0 ? '+' : '△'}${Math.abs(자본증가율).toFixed(1)}%)`
        ]
      },
      실적분석: {
        주요지표: [
          `• ROE (자기자본순이익률): ${ROE26.toFixed(1)}% (당기순이익 ${toKWithComma(당기순이익26)}K)`,
          `• ROA (총자산순이익률): ${ROA26.toFixed(1)}%`,
          `• 유동비율: ${유동비율25.toFixed(0)}% → ${유동비율26.toFixed(0)}% (${(유동비율26 - 유동비율25) > 0 ? '+' : '△'}${Math.abs(유동비율26 - 유동비율25).toFixed(0)}%p)`,
          `• 매출총이익률: ${매출총이익률25.toFixed(1)}% → ${매출총이익률26.toFixed(1)}% (${(매출총이익률26 - 매출총이익률25) > 0 ? '+' : '△'}${Math.abs(매출총이익률26 - 매출총이익률25).toFixed(1)}%p)`,
          `• 부채비율: ${부채비율25.toFixed(0)}% → ${부채비율26.toFixed(0)}% (${(부채비율26 - 부채비율25) > 0 ? '+' : '△'}${Math.abs(부채비율26 - 부채비율25).toFixed(0)}%p)`
        ],
        부채비율: [
          `• 부채비율: ${부채비율25.toFixed(0)}% → ${부채비율26.toFixed(0)}% (${(부채비율26 - 부채비율25) > 0 ? '+' : '△'}${(부채비율26 - 부채비율25).toFixed(0)}%p)`
        ]
      },
      심층분석: {
        수익성악화원인: [
          `• 매출은 전년 대비 ${실판매출증가율 >= 0 ? '+' : ''}${실판매출증가율.toFixed(1)}% 성장했으나 영업이익은 ${영업이익증가율 >= 0 ? '+' : '△'}${Math.abs(영업이익증가율).toFixed(1)}% ${영업이익증가율 < 0 ? '감소' : '증가'}.`,
          `• 매출총이익률 25년 ${매출총이익률25.toFixed(1)}% → 26년 ${매출총이익률26.toFixed(1)}% (${(매출총이익률26 - 매출총이익률25) >= 0 ? '+' : '△'}${Math.abs(매출총이익률26 - 매출총이익률25).toFixed(1)}%p).`,
          `• 영업비 ${영업비증가율 >= 0 ? '+' : '△'}${Math.abs(영업비증가율).toFixed(1)}% ${영업비증가율 >= 0 ? '증가' : '감소'}(광고비 ${광고비증가율 >= 0 ? '+' : '△'}${Math.abs(광고비증가율).toFixed(0)}% ${광고비증가율 >= 0 ? '증가' : '감소'}).`
        ],
        재고관리이슈: [
          `• 재고자산 25년 말 ${toKWithComma(재고25)}K → 26년 말 ${toKWithComma(재고26)}K (${재고증가율 >= 0 ? '+' : '△'}${Math.abs(재고증가율).toFixed(1)}% ${재고증가율 >= 0 ? '증가' : '감소'}).`
        ],
        여신리스크개선: [
          `• 외상매출금 25년 말 ${toKWithComma(AR25)}K → 26년 말 ${toKWithComma(AR26)}K (${AR증가율 <= 0 ? '△' : '+'}${Math.abs(AR증가율).toFixed(1)}% ${AR증가율 <= 0 ? '감소' : '증가'}).`
        ],
        재무건전성: [
          `• 부채비율 25년 말 ${부채비율25.toFixed(0)}% → 26년 말 ${부채비율26.toFixed(0)}% (전년 대비 ${(부채비율26 - 부채비율25) > 0 ? '+' : ''}${(부채비율26 - 부채비율25).toFixed(0)}%p ${(부채비율26 - 부채비율25) > 0 ? '악화' : '개선'}).`,
          `• 차입금 비율 25년 말 ${차입금비율25.toFixed(0)}% → 26년 말 ${차입금비율26.toFixed(0)}%.`,
          `• 유동비율 26년 말 ${유동비율26.toFixed(0)}%로 단기 유동성 양호.`
        ],
        긍정적요소: [
          `• ROE 26년 ${ROE26.toFixed(1)}%로 수익성 유지.`,
          `• 당기순이익 26년 ${toKWithComma(당기순이익26)}K.`
        ],
        재무구조개선: [
          `• 부채비율 ${Math.abs(부채비율개선p).toFixed(0)}%p ${부채비율개선p >= 0 ? '개선' : '악화'}의 구조: 부채 ${toMillion(Math.abs(부채26 - 부채25)).toLocaleString('ko-KR')}M ${부채26 <= 부채25 ? '감소(△' : '증가(+'}${Math.abs(부채감소율).toFixed(1)}%)와 자본 ${toMillion(Math.abs(자본26 - 자본25)).toLocaleString('ko-KR')}M ${자본26 >= 자본25 ? '증가(+' : '감소(△'}${Math.abs(자본증가율).toFixed(1)}%)의 복합 효과. 차입금 ${Math.abs(차입금감소율).toFixed(1)}% ${차입금감소율 >= 0 ? '급감' : '급증'}이 핵심 동인.`,
          `• 차입금 ${차입금25 >= 차입금26 ? '상환 재원 분석: 차입금 ' + toMillion(차입금25 - 차입금26).toLocaleString('ko-KR') + 'M 감축 재원: 영업현금흐름 ' + 영업현금흐름M.toLocaleString('ko-KR') + 'M + 운전자본 효율화 ' + 운전자본효율화M.toLocaleString('ko-KR') + 'M + 자본 ' + (자본26 >= 자본25 ? '증가 ' : '변동 ') + toMillion(Math.abs(자본26 - 자본25)).toLocaleString('ko-KR') + 'M. 영업활동 중심의 건전한 재무구조 개선.' : '증가 현황: 차입금이 ' + toMillion(차입금26 - 차입금25).toLocaleString('ko-KR') + 'M 증가. 영업현금흐름 ' + 영업현금흐름M.toLocaleString('ko-KR') + 'M으로 상환 능력 점검 필요.'}.`,
          `• 유동성 안정화: 유동비율 ${유동비율25.toFixed(0)}% → ${유동비율26.toFixed(0)}%로 ${Math.abs(유동비율26 - 유동비율25).toFixed(0)}%p 개선. 단기 채무 상환 능력 강화되며 재무 안정성 확보.`
        ]
      },
      주요성과: [
        `• 수익성 ${영업이익률개선p >= 0 ? '전환' : '변화'}: 영업이익률 ${영업이익률25.toFixed(1)}% → ${영업이익률26.toFixed(1)}%로 ${Math.abs(영업이익률개선p).toFixed(1)}%p ${영업이익률개선p >= 0 ? '개선' : '악화'}. 매출총이익률 ${Math.abs(매출총이익률개선p).toFixed(1)}%p ${매출총이익률개선p >= 0 ? '상승하며 원가구조 최적화 성공' : '하락하여 원가 관리 필요'}`,
        `• 재무구조 ${부채비율개선p >= 0 ? '정상화' : '변화'}: 부채비율 ${부채비율25.toFixed(0)}% → ${부채비율26.toFixed(0)}% ${부채비율개선p >= 0 ? '급감' : '상승'}. 차입금 ${Math.abs(차입금감소율).toFixed(1)}% ${차입금감소율 >= 0 ? '감축으로 재무 안정성 확보' : '증가로 부채 관리 필요'}`,
        `• 운전자본 효율화: 재고자산 ${재고증가율 < 0 ? Math.abs(재고증가율).toFixed(1) : '0'}% 감축, 외상매출금 ${AR증가율 < 0 ? Math.abs(AR증가율).toFixed(1) : '0'}% 개선으로 영업현금흐름 ${영업현금흐름M.toLocaleString('ko-KR')}M 창출`
      ],
      핵심분석: [
        `• 역설적 수익성 개선: 매출이 ${실판매출증가율 >= 0 ? '+' : ''}${실판매출증가율.toFixed(1)}% ${실판매출증가율 < 0 ? '감소' : '성장'}했음에도 영업이익은 ${영업이익증가율 >= 0 ? '+' : '△'}${Math.abs(영업이익증가율).toFixed(1)}% 급증. 이는 비용 통제와 수익성 중심 경영으로의 전환을 의미합니다.`,
        매출총이익률개선p >= 0
          ? `• 매출총이익률 개선: 매출총이익률이 ${매출총이익률25.toFixed(1)}% → ${매출총이익률26.toFixed(1)}%로 ${매출총이익률개선p.toFixed(1)}%p 상승. 직접비 관리 효율화와 원가구조 개선으로 수익성이 향상되었으며, 판관비 절감(△${toMillion(Math.abs(영업비YoY)).toLocaleString('ko-KR')}M)과의 복합 효과로 영업이익 증대 달성.`
          : `• 매출총이익률 하락 원인: 매출총이익률이 ${매출총이익률25.toFixed(1)}% → ${매출총이익률26.toFixed(1)}%로 ${Math.abs(매출총이익률개선p).toFixed(1)}%p 하락. 이는 직접비가 ${직접비증가율 >= 0 ? '+' : '△'}${Math.abs(직접비증가율).toFixed(1)}% 증가한 영향으로 보이나, 절대 매출총이익 감소폭(△${toMillion(Math.abs(매출총이익YoY)).toLocaleString('ko-KR')}M)을 판관비 절감(△${toMillion(Math.abs(영업비YoY)).toLocaleString('ko-KR')}M)과 영업효율화로 상쇄하여 영업이익 증대 달성.`,
        `• 비용 구조 ${영업비YoY감소율 >= 0 ? '최적화' : '점검 필요'}: 판관비가 ${Math.abs(영업비YoY감소율).toFixed(1)}% ${영업비YoY감소율 >= 0 ? '감소하며 비용 통제 성공' : '증가하여 비용 통제 필요'}. 광고비 ${광고비증가율 >= 0 ? '소폭 증가(' + '+' : '소폭 감소(△'}${Math.abs(광고비증가율).toFixed(1)}%), 전체 영업비 ${영업비증가율 >= 0 ? '관리 강화 필요' : '관리 효율화로 영업레버리지 개선'}.`
      ],
      핵심인사이트: [
        `• 재고 효율화의 현금 창출력: 재고자산 ${재고감축M > 0 ? `${재고감축M.toLocaleString('ko-KR')}M` : '0'} 감축은 단순 자산 축소가 아닌 현금화 전략. 재고회전일수 ${DIO단축일수}일 단축으로 연간 현금흐름 개선 기여도 추정 약 ${재고감축M > 0 ? 재고감축M.toLocaleString('ko-KR') : 0}M.`,
        `• 외상매출금 관리 강화: 외상매출금 ${AR증가율 < 0 ? Math.abs(AR증가율).toFixed(1) : '0'}% 감소는 회수 정책 강화 또는 고객 구조 변화를 시사. DSO(매출채권회전일수) ${DSO단축일수}일 단축으로 현금흐름 안정성 확보.`,
        `• CCC ${CCC단축일수}일 단축의 의미: 현금전환주기 ${Math.round(CCC25)}일 → ${Math.round(CCC26)}일로 ${CCC개선율.toFixed(0)}% 개선. 이는 영업현금흐름 ${영업현금흐름M.toLocaleString('ko-KR')}M 창출의 핵심 동인이며, 차입금 상환 재원 확보.`
      ],
      핵심이슈권고사항: [
        `• 매출 성장성 정체: 매출이 ${실판매출증가율 >= 0 ? '+' : ''}${실판매출증가율.toFixed(1)}% ${실판매출증가율 < 0 ? '감소' : '성장'}하며 성장 모멘텀 약화. 수익성 개선은 달성했으나, 지속가능한 성장을 위한 매출 확대 전략 필요.`,
        `• 직접비 상승률 > 매출 성장률: 직접비가 ${직접비증가율 >= 0 ? '+' : '△'}${Math.abs(직접비증가율).toFixed(1)}% 증가하여 매출 증가율을 상회. 원가 통제력 점검 및 가격 정책 재검토 필요.`,
        `• 총자산 ${자산증가율 >= 0 ? '+' : '△'}${Math.abs(자산증가율).toFixed(1)}% ${자산증가율 < 0 ? '감소' : '증가'}: 자산 규모 축소가 성장 제약 요인이 될 가능성. 효율성 개선과 성장 투자 간 균형 필요.`
      ],
      결론: [
        `2026년은 ${영업이익증가율 >= 0 && 부채비율개선p >= 0 ? '구조 개혁의 성과를 확인한 의미있는 해입니다.' : '수익성과 재무구조 전반을 점검해야 할 중요한 해입니다.'}`,
        `영업이익 ${영업이익증가율 >= 0 ? '+' : '△'}${Math.abs(영업이익증가율).toFixed(0)}% ${영업이익증가율 >= 0 ? '증가' : '감소'}, 부채비율 ${Math.abs(부채비율개선p).toFixed(0)}%p ${부채비율개선p >= 0 ? '개선' : '악화'}, 차입금 ${Math.abs(차입금감소율).toFixed(0)}% ${차입금감소율 >= 0 ? '감축' : '증가'} 등은 2026년 재무 성과의 핵심 지표입니다. 영업현금흐름 ${영업현금흐름M.toLocaleString('ko-KR')}M ${영업현금흐름M >= 0 ? '창출로 향후 성장 투자와 주주 가치 제고의 재원을 확보했다는 점에서 전략적 의미가 큽니다.' : '으로 현금흐름 개선이 필요한 상황입니다.'}`,
        `${실판매출증가율 < 0 ? '매출 성장성 정체와 ' : ''}${자산증가율 < 0 ? '총자산 축소는 지속가능한 성장을 위한 과제입니다. 효율성 개선을 유지하면서도 매출 확대 모멘텀을 되찾는 것이 2027년의 핵심 과제가 될 것입니다.' : '매출 성장세를 유지하며, 수익성과 재무구조의 균형 잡힌 성장을 이어가는 것이 2027년의 핵심 과제가 될 것입니다.'}`,
        `향후 6개월은 ${영업이익률개선p >= 0 ? '단기 성과 창출에 집중하되, 중장기적으로는 성장 투자를 재개하여' : '수익성 회복에 집중하면서'} '수익성'과 '성장성'의 균형을 이루는 것이 경영 전략의 핵심이 되어야 합니다.`
      ]
    }
  };
}

export async function GET() {
  try {
    // CSV 파일에서 직접 데이터 읽기 (2025·2026 기말 기준)
    const pl2025Path = path.join(process.cwd(), '파일', 'PL', '2025.csv');
    const pl2026Path = path.join(process.cwd(), '파일', 'PL', '2026.csv');
    const bs2025Path = path.join(process.cwd(), '파일', 'BS', '2025.csv');
    const bs2026Path = path.join(process.cwd(), '파일', 'BS', '2026.csv');
    
    const pl2025Data = await readCSV(pl2025Path, 2025);
    const pl2026Data = await readCSV(pl2026Path, 2026);
    const bs2025Data = await readCSV(bs2025Path, 2025);
    const bs2026Data = await readCSV(bs2026Path, 2026);
    
    const pl2025Rows = calculatePL(pl2025Data);
    const pl2026Rows = calculatePL(pl2026Data);
    const bs2025Rows = calculateBS(bs2025Data);
    const bs2026Rows = calculateBS(bs2026Data);

    let 영업활동YoY = 0;
    const cashflowDir = path.join(process.cwd(), '파일', 'cashflow');
    const cf2025Path = path.join(cashflowDir, '2025.csv');
    const cf2026Path = path.join(cashflowDir, '2026.csv');
    if (fs.existsSync(cf2026Path)) {
      try {
        const [data2025, data2026] = await Promise.all([
          fs.existsSync(cf2025Path) ? readCFHierarchyCSV(cf2025Path, 2025) : Promise.resolve({ year: 2025, rows: [] as CFHierarchyRow[] }),
          readCFHierarchyCSV(cf2026Path, 2026),
        ]);
        const prev = buildCFYearData(data2025.rows);
        const curr = buildCFYearData(data2026.rows);
        for (const r of data2026.rows) {
          if (r.대분류 !== '영업활동') continue;
          const key = rowKey(r.대분류, r.중분류, r.소분류);
          영업활동YoY += (curr.get(key) ?? 0) - (prev.get(key) ?? 0);
        }
      } catch (e) {
        console.warn('경영요약 CF 로드 실패, 영업현금흐름 0으로 처리:', e);
      }
    }

    let 운전자본YoY = 0;
    try {
      const wc2025 = calculateWorkingCapital(bs2025Data);
      const wc2026 = calculateWorkingCapital(bs2026Data);
      const sum25 = wc2025.find(r => r.account === '운전자본')?.values?.slice(0, 12).reduce((a, b) => (a ?? 0) + (b ?? 0), 0) ?? 0;
      const sum26 = wc2026.find(r => r.account === '운전자본')?.values?.slice(0, 12).reduce((a, b) => (a ?? 0) + (b ?? 0), 0) ?? 0;
      운전자본YoY = sum26 - sum25;
    } catch (e) {
      console.warn('경영요약 운전자본 YoY 계산 실패, 0으로 처리:', e);
    }

    const summary = generateSummary(pl2025Rows, pl2026Rows, bs2025Rows, bs2026Rows, 영업활동YoY, 운전자본YoY);
    
    return NextResponse.json(summary);
  } catch (error) {
    console.error('경영요약 API 에러:', error);
    return NextResponse.json(
      { error: '경영요약 데이터를 불러오는데 실패했습니다.' },
      { status: 500 }
    );
  }
}
