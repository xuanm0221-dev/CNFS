/**
 * 재고 계산 회귀 테스트 (외부 의존 없음)
 *
 *   npm test              골든값과 대조
 *   npm run test:update   골든값 재생성 (계산식을 의도적으로 바꿨을 때만)
 *
 * lib/inventory-calc.ts · lib/inventory-reorder.ts 의 순수 계산 결과를 고정 입력으로 뽑아
 * scripts/regression/golden.json 과 비교한다. 값이 달라지면 즉시 실패한다.
 */
const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, '..', '..', '.test-build');
const GOLDEN = path.join(__dirname, 'golden.json');
const UPDATE = process.argv.includes('--update');

// tsc 가 rootDir 를 lib/ 로 잡아 산출물이 평탄화된다
const calc = require(path.join(BUILD_DIR, 'inventory-calc.js'));
const reorder = require(path.join(BUILD_DIR, 'inventory-reorder.js'));

const SEASONS = ['당년F', '당년S', '1년차', '2년차', '차기시즌', '과시즌'];
const ACC = ['신발', '모자', '가방', '기타'];

/** 시드 고정 난수 — 실행할 때마다 같은 입력이 나온다 */
function makeRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function buildFixture(seed, withHqSales) {
  const rnd = makeRng(seed);
  const months = (scale) => Array.from({ length: 12 }, () => Math.round(rnd() * scale));
  return [...SEASONS, ...ACC].map((key) => {
    const row = {
      key,
      opening: Math.round(rnd() * 500000),
      sellIn: months(200000),
      sellOut: months(180000),
      closing: Math.round(rnd() * 400000),
    };
    if (withHqSales) row.hqSales = months(90000);
    return row;
  });
}

/** 부동소수 흔들림 방지 — 소수 6자리로 고정 */
function round(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(6)) : v;
}

function summarize(table) {
  const out = {};
  for (const r of table.rows) {
    out[r.key] = {
      opening: round(r.opening),
      sellInTotal: round(r.sellInTotal),
      sellOutTotal: round(r.sellOutTotal),
      closing: round(r.closing),
      delta: round(r.delta),
      sellThrough: round(r.sellThrough),
      woi: round(r.woi),
    };
  }
  return out;
}

function computeAll() {
  const result = {};
  const reorderMap = reorder.buildReorderByRowKey(reorder.MLB_REORDER_ACC_K);

  result['상수: MLB 리오더(CNY K)'] = reorder.MLB_REORDER_ACC_K;
  result['리오더 행매핑'] = reorderMap;

  for (const seed of [1, 7, 12345]) {
    for (const withHq of [false, true]) {
      for (const yearDays of [365, 366]) {
        const raws = buildFixture(seed, withHq);
        const table = calc.buildTableData(raws, yearDays);
        const label = `seed${seed}/${withHq ? '본사' : '대리상'}/${yearDays}일`;
        result[`재고표 ${label}`] = summarize(table);

        if (yearDays === 366) {
          result[`리오더-대리상 ${label}`] = summarize(reorder.applyReorderDealer(table, reorderMap));
          result[`리오더-본사 ${label}`] = summarize(reorder.applyReorderHq(table, reorderMap));
        }
      }
    }
  }
  return result;
}

/** 두 객체의 차이를 경로와 함께 모두 수집 */
function diff(a, b, p, out) {
  if (a === b) return;
  const bothObj = a && b && typeof a === 'object' && typeof b === 'object';
  if (!bothObj) {
    out.push(`${p}\n      golden = ${JSON.stringify(a)}\n      현재   = ${JSON.stringify(b)}`);
    return;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    diff(a[k], b[k], p ? `${p}.${k}` : k, out);
  }
}

const current = computeAll();

if (UPDATE || !fs.existsSync(GOLDEN)) {
  fs.writeFileSync(GOLDEN, JSON.stringify(current, null, 2) + '\n', 'utf-8');
  console.log(`골든값 생성 완료 → ${path.relative(process.cwd(), GOLDEN)}`);
  console.log(`  케이스 ${Object.keys(current).length}개`);
  process.exit(0);
}

const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf-8'));
const diffs = [];
diff(golden, current, '', diffs);

const cases = Object.keys(current).length;
if (diffs.length === 0) {
  console.log(`PASS  케이스 ${cases}개 — 계산 결과 변화 없음`);
  process.exit(0);
}

console.error(`FAIL  케이스 ${cases}개 중 ${diffs.length}곳이 달라졌습니다\n`);
diffs.slice(0, 30).forEach((d) => console.error('  - ' + d));
if (diffs.length > 30) console.error(`  ... 외 ${diffs.length - 30}곳`);
console.error('\n의도한 변경이면 npm run test:update 로 골든값을 갱신하세요.');
process.exit(1);
