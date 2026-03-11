import type { CFExplanationNumbers } from './cf-explanation-data';
import type { CFExplanationContent } from './types';

function M(value: number): string {
  const m = Math.round(value / 1_000_000);
  if (m >= 0) return `+${m}M`;
  return `△${Math.abs(m)}M`;
}

function Mabs(value: number): string {
  const m = Math.round(Math.abs(value) / 1_000_000);
  return `${m}M`;
}


/** 26년말 vs 25년말 YoY 기준: 절대값 M + "증가" | "감소" (자산은 yoy<0이 감소, 채무는 yoy>0이 감소) */
function changePhrase(yoy: number, isLiability: boolean): string {
  const absM = Math.round(Math.abs(yoy) / 1_000_000);
  if (absM === 0) return '변동 없음';
  const decrease = isLiability ? yoy > 0 : yoy < 0;
  return `${absM}M ${decrease ? '감소' : '증가'}`;
}

export function generateCFExplanationContent(n: CFExplanationNumbers): CFExplanationContent {
  const 영업M = M(n.영업활동_26);
  const 차입상환M = M(-n.차입금_기말_yoy);
  const 기말차입M = Math.round(n.차입금_기말_26 / 1_000_000);
  const 운전자본M = Math.round(n.운전자본_26 / 1_000_000);
  const 운전자본YoYM = M(n.운전자본_yoy);
  const 재고YoYM = M(n.재고자산_yoy);
  const 회수YoYM = M(n.매출채권_yoy);
  const 본사200M = n.매입채무_yoy !== 0 ? M(n.매입채무_yoy) : '200M 정상화';
  const 대리상ARYoYM = M(n.대리상AR_yoy);

  return {
    keyInsights: [
      `2026년 영업활동 현금흐름 ${영업M} 발생, 차입금 ${차입상환M} 상환으로 기말 ${기말차입M}M 차입금 목표.`,
      `2026년 기말 운전자본 ${운전자본M}M(${운전자본YoYM} YoY) 축소 계획.`,
      `재고 ${재고YoYM}(창고 재고 출고/판매), 회수 ${회수YoYM}, 본사 채무 ${본사200M} 정상화로 현금 유입.`,
      `대리상 채권 전년비 ${대리상ARYoYM}로 2024년 기말 수준 회복.`,
    ],
    cashFlow: [
      `영업활동: 매출수금 ${M(n.매출수금_yoy)} YoY, 물품대 ${M(n.물품대_yoy)} YoY(생산비·전년 미수 상환 반영).`,
      `자산성지출: 연간 (${Mabs(n.자산성지출_26)}), ${M(n.자산성지출_yoy)} YoY.`,
      `기타수익: 연간 ${Mabs(n.기타수익_26)}, ${M(n.기타수익_yoy)} YoY.`,
      `차입금: 연간 ${Mabs(Math.abs(n.차입금_26))} 상환.`,
      `Net Cash: 연간 (${Mabs(n.netCash_26)}), ${M(n.netCash_yoy)} YoY.`,
    ],
    workingCapital: [
      `매출채권: ${changePhrase(n.매출채권_yoy, false)}(26년말 vs 25년말), 현금 유입 및 구조 개선.`,
      `재고자산: ${changePhrase(n.재고자산_yoy, false)}(26년말 vs 25년말), 현금 유입, 보수적 재고 관리 정책 반영.`,
      `매입채무: ${changePhrase(n.매입채무_yoy, true)}(26년말 vs 25년말), 연체 해소 및 재고 매입 축소 반영.`,
    ],
    managementPoints: [
      '월별 운전자본 실적 vs 계획 점검(출하 계획·목표 재고 일수 기반 발주 진행).',
      '재고 적정성 검토 및 판매 추이에 따른 매입 계획 유연 조정.',
      '대리상 여신 한도 내 운영으로 재무 안정성 확보.',
    ],
  };
}
