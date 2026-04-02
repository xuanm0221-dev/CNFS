export type ForecastLeafBrand = 'mlb' | 'kids' | 'discovery';

export interface ForecastRowDef {
  account: string;
  level: number;
  isGroup: boolean;
  isCalculated: boolean;
  isBold?: boolean;
  format?: 'number' | 'percent';
}

export const FORECAST_BRANDS: { id: string | null; label: string }[] = [
  { id: null, label: '법인' },
  { id: 'mlb', label: 'MLB' },
  { id: 'kids', label: 'MLB KIDS' },
  { id: 'discovery', label: 'DISCOVERY' },
];

export const MONTH_HEADERS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

export const RAW_ACCOUNTS: string[] = [
  'Tag매출',
  '실판매출',
  '매출원가',
  '평가감',
  '급여(매장)',
  '복리후생비(매장)',
  '플랫폼수수료',
  'TP수수료',
  '직접광고비',
  '대리상지원금',
  '물류비',
  '매장임차료',
  '감가상각비',
  '기타(직접비)',
  '급여(사무실)',
  '복리후생비(사무실)',
  '광고비',
  '수주회',
  '지급수수료',
  '임차료',
  '감가상각비(영업비)',
  '세금과공과',
  '기타(영업비)',
];

export const DIRECT_EXPENSE_ACCOUNTS: string[] = [
  '급여(매장)',
  '복리후생비(매장)',
  '플랫폼수수료',
  'TP수수료',
  '직접광고비',
  '대리상지원금',
  '물류비',
  '매장임차료',
  '감가상각비',
  '기타(직접비)',
];

export const OPERATING_EXPENSE_ACCOUNTS: string[] = [
  '급여(사무실)',
  '복리후생비(사무실)',
  '광고비',
  '수주회',
  '지급수수료',
  '임차료',
  '감가상각비(영업비)',
  '세금과공과',
  '기타(영업비)',
];

export const ROWS_CORPORATE: ForecastRowDef[] = [
  { account: 'Tag매출', level: 0, isGroup: true, isCalculated: true, isBold: true, format: 'number' },
  { account: 'Tag매출_대리상', level: 1, isGroup: true, isCalculated: true, format: 'number' },
  { account: 'Tag매출_의류', level: 2, isGroup: false, isCalculated: true, format: 'number' },
  { account: 'Tag매출_ACC', level: 2, isGroup: false, isCalculated: true, format: 'number' },
  { account: 'Tag매출_직영', level: 1, isGroup: false, isCalculated: true, format: 'number' },
  { account: '실판매출(V+)', level: 0, isGroup: false, isCalculated: true, isBold: true, format: 'number' },
  { account: '실판매출', level: 0, isGroup: true, isCalculated: true, isBold: true, format: 'number' },
  { account: '실판매출_대리상', level: 1, isGroup: true, isCalculated: true, format: 'number' },
  { account: '실판매출_의류', level: 2, isGroup: false, isCalculated: true, format: 'number' },
  { account: '실판매출_ACC', level: 2, isGroup: false, isCalculated: true, format: 'number' },
  { account: '실판매출_직영', level: 1, isGroup: false, isCalculated: true, format: 'number' },
  { account: '매출원가 합계', level: 0, isGroup: true, isCalculated: true, isBold: true, format: 'number' },
  { account: '매출원가', level: 1, isGroup: false, isCalculated: false, format: 'number' },
  { account: '평가감', level: 1, isGroup: false, isCalculated: false, format: 'number' },
  { account: '(Tag 대비 원가율)', level: 1, isGroup: false, isCalculated: true, format: 'percent' },
  { account: '매출총이익', level: 0, isGroup: false, isCalculated: true, isBold: true, format: 'number' },
  { account: '직접비', level: 0, isGroup: true, isCalculated: true, isBold: true, format: 'number' },
  { account: '급여(매장)', level: 1, isGroup: false, isCalculated: false, format: 'number' },
  { account: '복리후생비(매장)', level: 1, isGroup: false, isCalculated: false, format: 'number' },
  { account: '플랫폼수수료', level: 1, isGroup: false, isCalculated: false, format: 'number' },
  { account: 'TP수수료', level: 1, isGroup: false, isCalculated: false, format: 'number' },
  { account: '직접광고비', level: 1, isGroup: false, isCalculated: false, format: 'number' },
  { account: '대리상지원금', level: 1, isGroup: false, isCalculated: false, format: 'number' },
  { account: '물류비', level: 1, isGroup: false, isCalculated: false, format: 'number' },
  { account: '매장임차료', level: 1, isGroup: false, isCalculated: false, format: 'number' },
  { account: '감가상각비', level: 1, isGroup: false, isCalculated: false, format: 'number' },
  { account: '기타(직접비)', level: 1, isGroup: false, isCalculated: false, format: 'number' },
  { account: '영업비', level: 0, isGroup: true, isCalculated: true, isBold: true, format: 'number' },
  { account: '급여(사무실)', level: 1, isGroup: false, isCalculated: false, format: 'number' },
  { account: '복리후생비(사무실)', level: 1, isGroup: false, isCalculated: false, format: 'number' },
  { account: '광고비', level: 1, isGroup: false, isCalculated: false, format: 'number' },
  { account: '수주회', level: 1, isGroup: false, isCalculated: false, format: 'number' },
  { account: '지급수수료', level: 1, isGroup: false, isCalculated: false, format: 'number' },
  { account: '임차료', level: 1, isGroup: false, isCalculated: false, format: 'number' },
  { account: '감가상각비(영업비)', level: 1, isGroup: false, isCalculated: false, format: 'number' },
  { account: '세금과공과', level: 1, isGroup: false, isCalculated: false, format: 'number' },
  { account: '기타(영업비)', level: 1, isGroup: false, isCalculated: false, format: 'number' },
  { account: '영업이익', level: 0, isGroup: false, isCalculated: true, isBold: true, format: 'number' },
  { account: '영업이익률', level: 0, isGroup: false, isCalculated: true, isBold: true, format: 'percent' },
];

export const ROWS_BRAND: ForecastRowDef[] = ROWS_CORPORATE.filter(
  (row) => !['MLB', 'KIDS', 'DISCOVERY'].includes(row.account),
).map((row) => ({ ...row }));

// ─── 시나리오 공용 타입 & 상수 ───────────────────────────────────────────────
export type SalesBrand = 'MLB' | 'MLB KIDS' | 'DISCOVERY';
export type ScenarioKey = 'negative' | 'base' | 'positive';

export interface ScenarioDef {
  key: ScenarioKey;
  label: string;
  shortLabel: string;
  color: string;
  bgColor: string;
  borderColor: string;
  dealerGrowthRate: Record<SalesBrand, number>;
  hqGrowthRate: Record<SalesBrand, number>;
}

export const SCENARIO_DEFS: Record<ScenarioKey, ScenarioDef> = {
  base: {
    key: 'base',
    label: '기존계획',
    shortLabel: '기존',
    color: '#3b5f93',
    bgColor: '#eff3fb',
    borderColor: '#3b5f93',
    dealerGrowthRate: { MLB: 5, 'MLB KIDS': -3, DISCOVERY: 280 },
    hqGrowthRate: { MLB: 15, 'MLB KIDS': 8, DISCOVERY: 137 },
  },
  positive: {
    key: 'positive',
    label: '긍정계획',
    shortLabel: '긍정',
    color: '#059669',
    bgColor: '#ecfdf5',
    borderColor: '#059669',
    dealerGrowthRate: { MLB: 10, 'MLB KIDS': 5, DISCOVERY: 330 },
    hqGrowthRate: { MLB: 20, 'MLB KIDS': 15, DISCOVERY: 200 },
  },
  negative: {
    key: 'negative',
    label: '부정계획',
    shortLabel: '부정',
    color: '#dc2626',
    bgColor: '#fef2f2',
    borderColor: '#dc2626',
    dealerGrowthRate: { MLB: 0, 'MLB KIDS': -5, DISCOVERY: 280 },
    hqGrowthRate: { MLB: 4, 'MLB KIDS': 0, DISCOVERY: 137 },
  },
};

export const SCENARIO_ORDER: ScenarioKey[] = ['negative', 'base', 'positive'];

export const ANNUAL_2025_RAW_BY_BRAND: Record<ForecastLeafBrand, Record<string, number>> = {
  mlb: {
    'Tag매출': 10620280950,
    '실판매출': 4580841611,
    '매출원가': 3346386042,
    '평가감': 4920661,
    '급여(매장)': 36120022,
    '복리후생비(매장)': 20569094,
    '플랫폼수수료': 51795485,
    'TP수수료': 53311908,
    '직접광고비': 96470314,
    '대리상지원금': 92892002,
    '물류비': 85408590,
    '매장임차료': 118246390,
    '감가상각비': 11065941,
    '기타(직접비)': 15840454,
    '급여(사무실)': 80189216,
    '복리후생비(사무실)': 29870228,
    '광고비': 148427270,
    '수주회': 11967758,
    '지급수수료': 20020704,
    '임차료': 20881648,
    '감가상각비(영업비)': 4642686,
    '세금과공과': 8307313,
    '기타(영업비)': 3456607,
  },
  kids: {
    'Tag매출': 430979785,
    '실판매출': 201167939,
    '매출원가': 139167347,
    '평가감': 1680543,
    '급여(매장)': 8220798,
    '복리후생비(매장)': 5128698,
    '플랫폼수수료': 4621624,
    'TP수수료': 3750274,
    '직접광고비': 7725712,
    '대리상지원금': 8011153.25,
    '물류비': 6660910,
    '매장임차료': 24838579,
    '감가상각비': 3207961,
    '기타(직접비)': 2321014,
    '급여(사무실)': 9813038,
    '복리후생비(사무실)': 2595146,
    '광고비': 17665823,
    '수주회': 709047,
    '지급수수료': 151874,
    '임차료': 0,
    '감가상각비(영업비)': 34356,
    '세금과공과': 0,
    '기타(영업비)': 538071,
  },
  discovery: {
    'Tag매출': 98436607,
    '실판매출': 49643126,
    '매출원가': 37168666,
    '평가감': 3324864,
    '급여(매장)': 1748125,
    '복리후생비(매장)': 913790,
    '플랫폼수수료': 915590,
    'TP수수료': 2856854,
    '직접광고비': 4167614,
    '대리상지원금': 4096750.42,
    '물류비': 2881486,
    '매장임차료': 6756711,
    '감가상각비': 867450,
    '기타(직접비)': 1248814,
    '급여(사무실)': 12679551,
    '복리후생비(사무실)': 3355399,
    '광고비': 43576852,
    '수주회': 1287576,
    '지급수수료': 1465034.98,
    '임차료': 0,
    '감가상각비(영업비)': 28149,
    '세금과공과': 0,
    '기타(영업비)': 724655,
  },
};
