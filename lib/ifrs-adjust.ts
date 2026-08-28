// IFRS 조정 상세 (파일/재무조정/{year}_상세.csv) → 손익계산서·PL(sim) 공용 시리즈 변환
//
// 표 구조 (영업이익률(관리식) 아래):
//   (IFRS)매출        = 관리식 실판매출(V-) + 매출 조정항목 합계
//   (IFRS)매출원가     = 관리식 매출원가 + 매출원가 조정항목 합계
//   (IFRS)평가감       = 관리식 평가감 + 평가감 조정항목 합계 (예: 폐기환입)
//   (IFRS)판관비       = 직접비 + 영업비 + 판관비 조정항목 합계
//   (IFRS)영업이익_현지법인기준 = 매출 - 매출원가 - 평가감 - 판관비
//   내부거래제거 후 영업이익    = 위 − Discovery 반품 (반품 순효과를 취소)
//
// 상세가 없는 달(미결산)은 항목이 0이라 자동으로 관리식 값과 같아진다.
import type { DetailAdjustData, DetailAdjustItem, DetailAdjustSection } from './csv';

export const IFRS_SECTIONS: DetailAdjustSection[] = ['매출', '매출원가', '평가감', '판관비'];

// 섹션마다 같은 항목명(예: 반품충당금)이 있어 account 키에 섹션을 포함시킨다.
// 화면에는 displayLabel(항목명)만 보여준다.
export function ifrsItemKey(section: DetailAdjustSection, item: string): string {
  return `IFRS조정|${section}|${item}`;
}

export const IFRS_SALES = '(IFRS)매출';
export const IFRS_COGS = '(IFRS)매출원가';
export const IFRS_VALUATION = '(IFRS)평가감';
export const IFRS_SGA = '(IFRS)판관비';
export const IFRS_OP = '(IFRS)영업이익_현지법인기준';
export const IFRS_OP_RATE = '(IFRS)영업이익률';
export const IFRS_OP_EXCL_INTER = '내부거래제거 후 영업이익';
export const IFRS_OP_EXCL_INTER_RATE = '내부거래제거 후 영업이익률';
export const IFRS_INTERCOMPANY_ITEM = 'IFRS내부거래|Discovery 반품';

export const IFRS_PARENT_OF: Record<DetailAdjustSection, string> = {
  매출: IFRS_SALES,
  매출원가: IFRS_COGS,
  평가감: IFRS_VALUATION,
  판관비: IFRS_SGA,
};

// 내부거래 항목 판별 — DISCOVERY 브랜드의 본사 반품.
// 상세 CSV에서 항목명이 '본사반품' / 'Discovery 반품' 두 형태로 쓰여 둘 다 인식한다.
const HQ_RETURN_ITEM_NAMES = ['본사반품', 'discovery 반품'];
export function isHqReturnItem(it: { brandRaw: string; item: string }): boolean {
  if (it.brandRaw.trim().toUpperCase() !== 'DISCOVERY') return false;
  return HQ_RETURN_ITEM_NAMES.includes(it.item.trim().toLowerCase());
}

export interface IFRSItemSeries {
  key: string;
  section: DetailAdjustSection;
  item: string;
  values: number[]; // 12개월
}

export interface IFRSAdjustSet {
  /** 섹션별 항목 시리즈 (표시 순서대로) */
  items: Record<DetailAdjustSection, IFRSItemSeries[]>;
  /** 섹션별 조정 합계 */
  total: Record<DetailAdjustSection, number[]>;
  /** Discovery 반품 행 값 = 본사반품매출 − 관련원가 (= (IFRS)영업이익에 반영된 순효과) */
  intercompany: number[];
  /** 조정 항목이 하나라도 있는지 */
  hasData: boolean;
}

const zeros = () => new Array(12).fill(0) as number[];

function emptySet(): IFRSAdjustSet {
  return {
    items: { 매출: [], 매출원가: [], 평가감: [], 판관비: [] },
    total: { 매출: zeros(), 매출원가: zeros(), 평가감: zeros(), 판관비: zeros() },
    intercompany: zeros(),
    hasData: false,
  };
}

function pickItems(data: DetailAdjustData | undefined, brand: string | null | undefined): DetailAdjustItem[] {
  if (!data) return [];
  if (brand == null) return data.items;
  return data.items.filter(it => it.brand === brand);
}

/**
 * 당해연도 상세 + (항목 목록 합집합용) 다른 연도 상세로 시리즈를 만든다.
 *
 * @param current  당해연도 상세 (없으면 빈 세트)
 * @param unionWith 항목 나열에만 쓰는 다른 연도 상세들 — 당해연도에 없는 항목도 0으로 행을 만들어
 *                  25/26년 어느 쪽에서 조정된 항목인지, 전년비가 얼마인지 볼 수 있게 한다.
 * @param brand    브랜드키(mlb/kids/...) — 지정하면 해당 브랜드만, null/undefined면 법인(전 브랜드 합산)
 */
export function buildIFRSAdjust(
  current: DetailAdjustData | undefined,
  unionWith: (DetailAdjustData | undefined)[] = [],
  brand?: string | null,
): IFRSAdjustSet {
  const currentItems = pickItems(current, brand);
  if (!current) return emptySet();

  const out = emptySet();
  out.hasData = currentItems.length > 0;

  for (const section of IFRS_SECTIONS) {
    // 표시 순서: 당해연도 파일 순서 → 다른 연도에만 있는 항목
    const order: string[] = [];
    const seen = new Set<string>();
    const pushName = (name: string) => {
      if (seen.has(name)) return;
      seen.add(name);
      order.push(name);
    };
    for (const it of currentItems) if (it.section === section) pushName(it.item);
    for (const other of unionWith) {
      for (const it of pickItems(other, brand)) if (it.section === section) pushName(it.item);
    }

    // 같은 항목명은 브랜드에 상관없이 합산 (법인 표는 전 브랜드 합, 브랜드 표는 해당 브랜드만)
    const sums = new Map<string, number[]>();
    for (const it of currentItems) {
      if (it.section !== section) continue;
      let arr = sums.get(it.item);
      if (!arr) { arr = zeros(); sums.set(it.item, arr); }
      for (let i = 0; i < 12; i++) arr[i] += it.values[i];
    }

    out.items[section] = order.map(item => ({
      key: ifrsItemKey(section, item),
      section,
      item,
      values: sums.get(item) ?? zeros(),
    }));
    for (const s of out.items[section]) {
      for (let i = 0; i < 12; i++) out.total[section][i] += s.values[i];
    }
  }

  // 내부거래(본사반품): 매출 +A / 매출원가 +B 로 (IFRS)영업이익에 (A−B) 가 반영되어 있다.
  // 행에는 그 순효과 (A−B) 를 그대로 보여주고, 제거(취소)는 부호 반대로 차감한다.
  const hq = { 매출: zeros(), 매출원가: zeros() };
  for (const it of currentItems) {
    if (!isHqReturnItem(it)) continue;
    if (it.section === '매출' || it.section === '매출원가') {
      for (let i = 0; i < 12; i++) hq[it.section][i] += it.values[i];
    }
  }
  for (let i = 0; i < 12; i++) out.intercompany[i] = hq['매출'][i] - hq['매출원가'][i];

  return out;
}
