# -*- coding: utf-8 -*-
"""
원본 엑셀 → 파일/PL_brand/{brand}/{year}.csv 생성기

매월 손으로 CSV 를 고치던 작업을 대신한다. 엑셀 자체는 git 에 올리지 않고
(엑셀파일(git푸시제외)/ 은 .gitignore 처리) 산출물인 CSV 만 커밋한다.

  python scripts/excel_to_pl_csv.py --month 26.08              # 차이만 출력 (기본)
  python scripts/excel_to_pl_csv.py --month 26.08 --apply      # 실제 CSV 반영
  python scripts/excel_to_pl_csv.py --month 26.08 --brand mlb  # 브랜드 한정

기본이 "차이 출력"인 이유: 수기로 조정해 둔 값(월 이동 포함)을 스크립트가
소리 없이 덮어쓰지 않게 하려는 것. 차이를 눈으로 확인한 뒤에만 --apply 한다.
연간합계가 같은데 월별만 다르면 '월 이동'으로 표시된다.

보류 항목: Tag매출_{대리상,직영}_{ACC,APP} 4행은 건드리지 않는다(기존 CSV 유지).
  - 대리상 ACC/APP 는 '#. 연간({브랜드})' 시트에 있고
  - 직영 ACC/APP 는 계획월만 ALL_BRANDS_Stock_Devaluation 의 '직영출고' 시트에 있다
  실적월 직영 ACC/APP 소스가 정해지면 그때 붙인다.
"""
import argparse, csv, glob, io, os, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── 브랜드: CSV 폴더명 → (엑셀 시트 약어, 표시명) ──
# (CSV 폴더명, PL 시트 약어, '#. 연간' 시트 약어, 표시명)
# SUPRA 만 두 시트의 약어가 다르다: PL-SUPRA(26년) / #. 연간(SP)
BRANDS = [
    ('mlb',       'MLB',   'MLB',  'MLB'),
    ('kids',      'KIDS',  'KIDS', 'MLB KIDS'),
    ('discovery', 'DX',    'DX',   'DISCOVERY'),
    ('duvetica',  'DV',    'DV',   'DUVETICA'),
    ('supra',     'SUPRA', 'SP',   'SUPRA'),
]

# ── 엑셀 시트 레이아웃 (5개 PL 시트가 모두 동일한 것을 확인함) ──
LABEL_COL_1 = 4        # D열 Mapping-1
LABEL_COL_2 = 5        # E열 Mapping-2
MONTH_COL_0 = 7        # 1월 블록 시작 (G열)
MONTH_STEP = 11        # 월 블록 폭
CH_OFFSET = {          # 블록 내 Amt 열 오프셋. OR=직영, FR=대리상, EC=온라인
    'EC_OR': 0, 'EC_FR': 2, 'OFF_OR': 4, 'OFF_FR': 6, 'TOTAL': 8,
}
UNIT = 1000            # 엑셀은 千 CNY, CSV 는 元

# ── CSV 계정과목 → 엑셀 (Mapping-2 라벨, 채널) ──
# 블록: 'D'=직접비 블록 안, 'M'=영업비 블록 안, None=블록 무관
#   'Others' 와 'Service Fee/fee' 가 두 블록에 중복 등장하므로 블록 지정이 필요하다.
DIRECT = [
    ('급여(매장)',       'Store Payroll'),
    ('복리후생비(매장)',  'Store Staff Benefits'),
    ('플랫폼수수료',     'Platform Commission'),
    ('TP수수료',        'T P commission'),
    ('직접광고비',       'Advertisement-Direct'),
    ('대리상지원금',     'Franchiser Rebate'),
    ('물류비',          'Logistic Expense'),
    ('매장임차료',       'Store Rental'),
    ('감가상각비',       'Store D&A'),
]
MGMT = [
    ('급여(사무실)',      'Salary'),
    ('복리후생비(사무실)', 'Staff Benefits'),
    ('광고비',           'Advertisement-Shared'),
    ('수주회',           'Tradeshow'),
    ('지급수수료',        'Service fee'),
    ('임차료',           'Office Rental'),
    ('감가상각비(영업비)', 'D&A'),
    ('세금과공과',        'TAX'),
    ('기타(영업비)',      'Others'),
]
# 기타(직접비) = 직접비 블록의 나머지 4개 합 (값으로 검증 완료)
OTHER_DIRECT_PARTS = ['Service Fee', 'Package', 'VMD', 'Others']

# 스크립트가 만들지 않는 행 (기존 CSV 값 그대로 둔다)
SKIP_ACCOUNTS = {
    'Tag매출_대리상_ACC', 'Tag매출_대리상_APP',
    'Tag매출_직영_ACC', 'Tag매출_직영_APP',
}


def build_spec():
    """CSV 계정과목 → (라벨, 채널, 블록) 매핑표"""
    spec = {}
    for csv_acc, ch in [('Tag매출', 'TOTAL'), ('Tag매출_직영(ON)', 'EC_OR'),
                        ('Tag매출_직영(OFF)', 'OFF_OR'), ('Tag매출_대리상(ON)', 'EC_FR'),
                        ('Tag매출_대리상(OFF)', 'OFF_FR')]:
        spec[csv_acc] = ('Tag Sales', ch, None)
    for csv_acc, ch in [('실판매출', 'TOTAL'), ('실판매출_직영(ON)', 'EC_OR'),
                        ('실판매출_직영(OFF)', 'OFF_OR'), ('실판매출_대리상(ON)', 'EC_FR'),
                        ('실판매출_대리상(OFF)', 'OFF_FR')]:
        spec[csv_acc] = ('Sales Revenue（VAT-）', ch, None)
    spec['매출원가'] = ('COGS', 'TOTAL', None)
    # 평가감(설정) 은 여기서 만들지 않는다. 재무식은 분기(3·6·9·12월)에 평가감을
    # 다시 계산해 수기로 넣는데, PL 시트에는 그 조정 전 값이 남아 있다.
    # 조정 후 정본은 '#. 연간({브랜드})' 의 재고평가감 행 → read_valuation() 에서 읽고
    #   평가감      = 재고평가감
    #   평가감(설정) = 평가감 − 평가감(환입)
    # 로 되돌린다. 환입은 PL 시트 값이 정본과 일치하는 것을 확인했다.
    spec['평가감(환입)'] = ('Impairment-Reversal', 'TOTAL', None)
    for csv_acc, lab in DIRECT:
        spec[csv_acc] = (lab, 'TOTAL', 'D')
    for csv_acc, lab in MGMT:
        spec[csv_acc] = (lab, 'TOTAL', 'M')
    return spec


SPEC = build_spec()


# ────────────────────────── 엑셀 읽기 ──────────────────────────
def load_sheet(wb, sheet_name):
    """PL 시트를 (행,열) 격자로 읽는다. 1-based 접근용 헬퍼를 함께 돌려준다."""
    ws = wb[sheet_name]
    grid = list(ws.iter_rows(min_row=1, max_row=min(ws.max_row, 60),
                             max_col=MONTH_COL_0 + MONTH_STEP * 12, values_only=True))

    def cell(r, c):
        if r - 1 >= len(grid):
            return None
        row = grid[r - 1]
        return row[c - 1] if c - 1 < len(row) else None

    def label(r, col):
        v = cell(r, col)
        return '' if v is None else str(v).strip()

    return grid, cell, label


def find_blocks(grid, label):
    """직접비/영업비 블록의 행 범위를 라벨로 찾는다 (행번호 하드코딩 회피)."""
    n = len(grid)
    d_start = m_start = None
    for r in range(1, n + 1):
        m1 = label(r, LABEL_COL_1)
        if m1 == 'Direct cost' and d_start is None:
            d_start = r
        elif m1 == 'Management Cost' and m_start is None:
            m_start = r
    if d_start is None or m_start is None:
        raise RuntimeError('직접비/영업비 블록을 찾지 못했습니다')

    def block_end(start, marker_col):
        for r in range(start, n + 1):
            if label(r, marker_col) == 'Total':
                return r
        return n

    return (d_start, block_end(d_start, LABEL_COL_2)), (m_start, block_end(m_start, LABEL_COL_1))


def find_row(label, target, rng=None, n=60):
    """Mapping-2 우선, 없으면 Mapping-1 로 라벨이 일치하는 행을 찾는다."""
    lo, hi = rng if rng else (1, n)
    for r in range(lo, hi + 1):
        if label(r, LABEL_COL_2) == target:
            return r
    for r in range(lo, hi + 1):
        if label(r, LABEL_COL_1) == target:
            return r
    return None


def raw_value(cell, row, channel, month):
    """월 블록에서 해당 채널의 Amt 를 엑셀 원단위(千) 그대로 돌려준다."""
    col = MONTH_COL_0 + MONTH_STEP * (month - 1) + CH_OFFSET[channel]
    v = cell(row, col)
    if not isinstance(v, (int, float)) or isinstance(v, bool):
        return None
    return float(v)


def month_value(cell, row, channel, month):
    """월 블록에서 해당 채널의 Amt 값을 元 단위로 돌려준다."""
    v = raw_value(cell, row, channel, month)
    return None if v is None else round(v * UNIT)


def read_brand(wb, sheet_name):
    """한 브랜드 PL 시트 → {계정과목: [12개월 값]}"""
    grid, cell, label = load_sheet(wb, sheet_name)
    (d_lo, d_hi), (m_lo, m_hi) = find_blocks(grid, label)
    out, missing = {}, []

    for acc, (lab, ch, block) in SPEC.items():
        rng = (d_lo, d_hi) if block == 'D' else (m_lo, m_hi) if block == 'M' else None
        r = find_row(label, lab, rng, len(grid))
        if r is None:
            missing.append('%s (라벨 %r)' % (acc, lab))
            continue
        out[acc] = [month_value(cell, r, ch, m) for m in range(1, 13)]

    # 기타(직접비) = 직접비 블록의 Service Fee + Package + VMD + Others
    # 千 단위에서 먼저 더하고 마지막에 한 번만 반올림한다. 항목별로 반올림하면
    # 4개가 쌓여 연간 2~3원씩 어긋나 진짜 차이인 것처럼 보인다.
    parts = []
    for lab in OTHER_DIRECT_PARTS:
        r = find_row(label, lab, (d_lo, d_hi), len(grid))
        if r is None:
            missing.append('기타(직접비) 구성 %r' % lab)
        else:
            parts.append([raw_value(cell, r, 'TOTAL', m) for m in range(1, 13)])
    if len(parts) == len(OTHER_DIRECT_PARTS):
        out['기타(직접비)'] = [
            None if all(p[i] is None for p in parts)
            else round(sum((p[i] or 0.0) for p in parts) * UNIT)
            for i in range(12)
        ]

    return out, missing


# ── '#. 연간({브랜드})' 시트: 분기 재계산이 반영된 재고평가감 ──
ANNUAL_MONTH_COL_0 = 8   # 1월
ANNUAL_MONTH_STEP = 2    # 월 간격 (금액 | % 두 칸)


def read_valuation(wb, sheet_name):
    """재고평가감 12개월을 元 단위로 돌려준다. 못 찾으면 (None, 사유)."""
    if sheet_name not in wb.sheetnames:
        return None, '시트 없음: %s' % sheet_name
    ws = wb[sheet_name]
    grid = list(ws.iter_rows(min_row=1, max_row=min(ws.max_row, 200),
                             max_col=ANNUAL_MONTH_COL_0 + ANNUAL_MONTH_STEP * 12, values_only=True))

    def cell(r, c):
        row = grid[r - 1]
        return row[c - 1] if c - 1 < len(row) else None

    def col_of(m):
        return ANNUAL_MONTH_COL_0 + ANNUAL_MONTH_STEP * (m - 1)

    # 월 헤더행: 브랜드마다 숫자(1..12) 이거나 텍스트('1월'..'12월') 라서 둘 다 받는다
    header = None
    for r in range(1, len(grid) + 1):
        ok = True
        for m in range(1, 13):
            v = cell(r, col_of(m))
            if isinstance(v, (int, float)) and not isinstance(v, bool) and int(v) == m:
                continue
            if isinstance(v, str) and v.strip() == '%d월' % m:
                continue
            ok = False
            break
        if ok:
            header = r
            break
    if header is None:
        return None, '월 헤더행을 찾지 못함 (%s)' % sheet_name

    # 재고평가감 행 (라벨이 5~7열 중 어디에 있는지는 브랜드마다 다르다)
    target = None
    for r in range(header, len(grid) + 1):
        for c in (5, 6, 7):
            v = cell(r, c)
            if isinstance(v, str) and '재고평가감' in v:
                target = r
                break
        if target:
            break
    if target is None:
        return None, '재고평가감 행을 찾지 못함 (%s)' % sheet_name

    vals = []
    for m in range(1, 13):
        v = cell(target, col_of(m))
        vals.append(round(v * UNIT) if isinstance(v, (int, float)) and not isinstance(v, bool) else None)
    return vals, None


# ────────────────────────── CSV 읽기/쓰기 ──────────────────────────
def parse_num(s):
    t = (s or '').strip().replace(',', '')
    if t in ('', '-'):
        return None
    try:
        return float(t)
    except ValueError:
        return None


def fmt_num(v):
    return '{:,}'.format(int(round(v)))


def read_csv_rows(path):
    with io.open(path, encoding='utf-8-sig', newline='') as f:
        return list(csv.reader(f))


def write_csv_rows(path, rows):
    # 원본과 동일하게 UTF-8 BOM + CRLF 로 쓴다
    with io.open(path, 'w', encoding='utf-8-sig', newline='') as f:
        csv.writer(f, lineterminator='\r\n').writerow(rows[0])
        for r in rows[1:]:
            csv.writer(f, lineterminator='\r\n').writerow(r)


# ── 수기 조정 잠금표 ──
# 엑셀과 다르지만 CSV 값이 정본인 셀. 스크립트가 덮어쓰지 않고 따로 보고만 한다.
# 형식: 브랜드,계정과목,월,사유   (브랜드 = CSV 폴더명)
LOCK_PATH = os.path.join('파일', 'PL_brand', '_수기조정.csv')


def load_locks():
    path = os.path.join(ROOT, LOCK_PATH)
    locks = {}
    if not os.path.exists(path):
        return locks
    with io.open(path, encoding='utf-8-sig', newline='') as f:
        for i, row in enumerate(csv.reader(f)):
            if i == 0 or len(row) < 3 or not row[0].strip():
                continue
            try:
                month = int(row[2])
            except ValueError:
                continue
            locks[(row[0].strip(), row[1].strip(), month)] = (row[3].strip() if len(row) > 3 else '')
    return locks


# ────────────────────────── 비교 ──────────────────────────
def compare(rows, excel, tol=1.0, locks=None, brand=None):
    """CSV 현재값 vs 엑셀값.

    돌려주는 값: (반영대상 차이, 계정별 연간합계, 잠금으로 건너뛴 차이)
    """
    locks = locks or {}
    diffs, annual, locked = [], {}, []
    for i, row in enumerate(rows):
        if i == 0 or not row or not row[0].strip():
            continue
        acc = row[0].strip()
        if acc in SKIP_ACCOUNTS or acc not in excel:
            continue
        cur_sum = exl_sum = 0.0
        hit = False
        for m in range(1, 13):
            cur = parse_num(row[m]) if m < len(row) else None
            exl = excel[acc][m - 1]
            cur_sum += cur or 0
            exl_sum += exl or 0
            if exl is None:
                continue
            # 빈칸과 0 은 같은 뜻이라 차이로 보지 않는다 (SUPRA 처럼 빈 달이 많은 경우)
            if cur is None and abs(exl) <= tol:
                continue
            if cur is not None and abs(cur - exl) <= tol:
                continue
            if (brand, acc, m) in locks:
                locked.append((acc, m, cur, exl, locks[(brand, acc, m)]))
                continue
            diffs.append((i, acc, m, cur, exl))
            hit = True
        # 연간합계는 월별 차이가 실제로 있는 계정만 보여준다.
        # 그러지 않으면 월별 반올림이 12번 쌓인 몇 원 차이까지 올라온다.
        if hit:
            annual[acc] = (cur_sum, exl_sum)
    return diffs, annual, locked


def report(brand_label, path, diffs, annual, missing, locked=()):
    print('=' * 78)
    print('### %s   %s' % (brand_label, path))
    if missing:
        print('  [경고] 엑셀에서 못 찾은 항목: %s' % ', '.join(missing))
    for acc, m, cur, exl, why in locked:
        print('  [수기조정 보존] %s %d월  CSV %s (엑셀 %s)  — %s' % (
            acc, m,
            fmt_num(cur) if cur is not None else '(없음)',
            fmt_num(exl) if exl is not None else '(없음)', why))
    if not diffs:
        print('  차이 없음 (보류 4행 제외)')
        return
    print('  %-20s %3s %16s %16s %14s' % ('계정과목', '월', '현재 CSV', '엑셀', '차이'))
    print('  ' + '-' * 74)
    for _, acc, m, cur, exl in diffs:
        d = (exl - (cur or 0))
        print('  %-20s %2d월 %16s %16s %14s' % (
            acc[:20], m,
            fmt_num(cur) if cur is not None else '(없음)',
            fmt_num(exl), '{:+,}'.format(int(round(d)))))
    print()
    for acc, (cs, es) in sorted(annual.items()):
        tag = '연간합계 동일 → 월 이동으로 보임' if abs(cs - es) <= 1 else '연간합계도 다름'
        print('  · %-20s 현재 %16s / 엑셀 %16s   %s' % (acc[:20], fmt_num(cs), fmt_num(es), tag))
    print()


def apply_diffs(rows, diffs):
    """값이 실제로 바뀐 셀만 갈아끼운다 (그대로인 셀은 원문 유지 → git diff 최소화)."""
    for i, _, m, _, exl in diffs:
        rows[i][m] = fmt_num(exl)
    return rows


# ── PL 시트 이름 해석 ──
# 월마다 시트명이 다르다: 26.08 은 'PL-MLB(26년)', 26.07 은 'PL-MLB' (+ 중복본 'PL-MLB (2)').
# 이름만으로는 연도를 못 믿으므로 R10 의 연도 마커(2026.01)로 확인한다.
YEAR_MARKER_ROW = 10


def sheet_year(wb, name):
    """시트의 연도 마커(R10, 1월 블록)에서 연도를 읽는다. 못 읽으면 None."""
    ws = wb[name]
    for row in ws.iter_rows(min_row=YEAR_MARKER_ROW, max_row=YEAR_MARKER_ROW,
                            max_col=MONTH_COL_0, values_only=True):
        v = row[MONTH_COL_0 - 1] if len(row) >= MONTH_COL_0 else None
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return int(v)          # 2026.01 → 2026
        if isinstance(v, str) and v.strip()[:4].isdigit():
            return int(v.strip()[:4])
    return None


def resolve_pl_sheet(wb, abbr, year):
    """PL-{약어} 계열 시트 중 해당 연도인 것을 고른다.

    'PL-MLB (2)' 같은 중복본이 있어 이름이 짧은 쪽(원본)을 우선한다.
    """
    exact = 'PL-%s(%s년)' % (abbr, year[2:])
    if exact in wb.sheetnames:
        return exact, None
    cands = [n for n in wb.sheetnames
             if n == 'PL-%s' % abbr or n.startswith('PL-%s ' % abbr) or n.startswith('PL-%s(' % abbr)]
    if not cands:
        return None, '시트 없음: PL-%s*' % abbr
    matched = [n for n in cands if sheet_year(wb, n) == int(year)]
    if not matched:
        return None, '%s년 시트를 못 찾음 (후보: %s)' % (year, ', '.join(cands))
    matched.sort(key=lambda n: (len(n), n))
    return matched[0], None


# ── 기준월 기록 ──
# 2026.csv 가 지금 몇 월 기준인지 남긴다. 같은 달을 다시 반영할 때
# 기존(2026_기존.csv)이 덮어써지는 사고를 막기 위한 것이다.
BASEMONTH_PATH = os.path.join('파일', 'PL_brand', '_기준월.csv')


def load_basemonths():
    path = os.path.join(ROOT, BASEMONTH_PATH)
    out = {}
    if not os.path.exists(path):
        return out
    with io.open(path, encoding='utf-8-sig', newline='') as f:
        for i, row in enumerate(csv.reader(f)):
            if i == 0 or len(row) < 3 or not row[0].strip():
                continue
            out[row[0].strip()] = (row[1].strip(), row[2].strip())   # year -> (current, baseline)
    return out


def save_basemonths(data):
    path = os.path.join(ROOT, BASEMONTH_PATH)
    with io.open(path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f, lineterminator='\r\n')
        w.writerow(['연도', '현재기준월', '기존기준월'])
        for year in sorted(data):
            cur, base = data[year]
            w.writerow([year, cur, base])


# ────────────────────────── main ──────────────────────────
def find_workbook(month):
    folder = os.path.join(ROOT, '엑셀파일(git푸시제외)', month)
    if not os.path.isdir(folder):
        sys.exit('엑셀 폴더가 없습니다: %s' % folder)
    cands = [c for c in glob.glob(os.path.join(folder, '*실적보고*.xlsx'))
             if not os.path.basename(c).startswith('~$')]
    if not cands:
        sys.exit('실적보고 엑셀을 찾지 못했습니다: %s' % folder)
    return cands[0]


def run_pass(month, year, baseline, brand_filter, do_apply, locks):
    """엑셀 한 개 → CSV 한 벌. baseline=True 면 {year}_기존.csv 를 대상으로."""
    import openpyxl

    xlsx = find_workbook(month)
    target = '%s_기존.csv (전월 보고본)' % year if baseline else '%s.csv (현재 버전)' % year
    print('=' * 78)
    print('엑셀 %s  →  %s' % (os.path.relpath(xlsx, ROOT), target))
    print('모드: %s' % ('반영(--apply)' if do_apply else '차이 확인만'))
    print()

    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
    total = 0
    try:
        for folder_name, pl_abbr, annual_abbr, label_name in BRANDS:
            if brand_filter and brand_filter != folder_name:
                continue
            sheet, sheet_err = resolve_pl_sheet(wb, pl_abbr, year)
            if sheet_err:
                print('[건너뜀] %s — %s' % (label_name, sheet_err))
                continue
            csv_name = '%s_기존.csv' % year if baseline else '%s.csv' % year
            csv_path = os.path.join(ROOT, '파일', 'PL_brand', folder_name, csv_name)
            if not os.path.exists(csv_path):
                print('[건너뜀] CSV 없음: %s' % csv_path)
                continue

            excel, missing = read_brand(wb, sheet)

            # 평가감: '#. 연간' 의 재고평가감(분기 재계산 반영분)이 정본.
            # 설정 = 평가감 − 환입 으로 되돌린다.
            val, err = read_valuation(wb, '#. 연간(%s)' % annual_abbr)
            if err:
                missing.append('평가감 — %s' % err)
            else:
                excel['평가감'] = val
                rev = excel.get('평가감(환입)')
                if rev:
                    excel['평가감(설정)'] = [
                        None if (val[i] is None and rev[i] is None)
                        else (val[i] or 0) - (rev[i] or 0)
                        for i in range(12)
                    ]

            rows = read_csv_rows(csv_path)
            diffs, annual, locked = compare(rows, excel, locks=locks, brand=folder_name)
            report(label_name, os.path.relpath(csv_path, ROOT), diffs, annual, missing, locked)
            total += len(diffs)

            if do_apply and diffs:
                write_csv_rows(csv_path, apply_diffs(rows, diffs))
                print('  → %d개 셀 반영 완료' % len(diffs))
                print()
    finally:
        wb.close()

    print('%s: 차이 셀 %d개' % (target, total))
    print()
    return total


def main():
    ap = argparse.ArgumentParser(
        description='원본 엑셀 → 파일/PL_brand/{brand}/{year}.csv 생성기')
    ap.add_argument('--month', required=True, help='엑셀 폴더명 (예: 26.08)')
    ap.add_argument('--prev', help='전월 엑셀 폴더명 (예: 26.07). 주면 {year}_기존.csv 도 함께 만든다')
    ap.add_argument('--year', default='2026', help='대상 CSV 연도 (기본 2026)')
    ap.add_argument('--brand', help='브랜드 폴더명 한정 (mlb/kids/discovery/duvetica/supra)')
    ap.add_argument('--apply', action='store_true', help='실제 CSV 에 반영 (미지정 시 차이만 출력)')
    ap.add_argument('--baseline', action='store_true',
                    help='--month 을 {year}_기존.csv 에만 반영 (전월분 단독 재생성)')
    args = ap.parse_args()

    locks = load_locks()
    if locks:
        print('수기조정 잠금 %d개 셀 (%s)' % (len(locks), LOCK_PATH))
        print()

    # 기존(_기존.csv)은 현재 CSV 를 복사해 만들지 않는다. 전월 엑셀에서 직접 만든다.
    #   복사 방식이면 같은 달을 두 번 반영할 때, 이미 이번 달 값이 된 CSV 가 기존을
    #   덮어써 전월 보고본이 사라진다. 원료(엑셀)가 월별로 남아 있으므로 언제 돌려도
    #   같은 결과가 나오는 쪽을 택했다.
    total = 0
    if args.baseline:
        total += run_pass(args.month, args.year, True, args.brand, args.apply, locks)
        cur_rec, base_rec = None, args.month
    else:
        total += run_pass(args.month, args.year, False, args.brand, args.apply, locks)
        cur_rec, base_rec = args.month, None
        if args.prev:
            total += run_pass(args.prev, args.year, True, args.brand, args.apply, locks)
            base_rec = args.prev

    print('=' * 78)
    print('전체 차이 셀 %d개%s' % (total, '' if args.apply else '  (반영하려면 --apply)'))

    if args.apply and not args.brand:
        bm = load_basemonths()
        cur, base = bm.get(args.year, ('', ''))
        if cur_rec:
            cur = cur_rec
        if base_rec:
            base = base_rec
        bm[args.year] = (cur, base)
        save_basemonths(bm)
        print('기준월 기록: 현재 %s / 기존 %s  (%s)'
              % (cur or '미기록', base or '미기록', BASEMONTH_PATH))
    elif args.apply and args.brand:
        print('[주의] --brand 지정 실행이라 기준월 기록을 갱신하지 않았습니다.')


if __name__ == '__main__':
    main()
