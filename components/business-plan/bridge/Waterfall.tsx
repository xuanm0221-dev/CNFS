'use client';

/**
 * 영업이익 Bridge 워터폴.
 * 원본 bridge.html 의 renderWaterfall() 기하 계산을 그대로 옮긴 선언형 SVG.
 *
 * 막대 8개 = 전년 영업이익 → Tag매출·할인·원가율·평가감·직접비·영업비 → 당년 영업이익.
 * 양끝(총계)은 0 부터 그린 절대 막대, 가운데 6개는 누적값 위에 얹는 증감 막대.
 */
import { BridgeResult, fmtK, fmtKsigned, ITEM_LABEL_SHORT, ITEM_ORDER, Totals } from './calc';

export interface WaterfallGeom {
  viewW: number; viewH: number;
  x0: number; x1: number;
  baseline: number; topLim: number;
}

/** 전체 탭 (넓고 낮음) */
export const GEOM_ALL: WaterfallGeom = {
  viewW: 1160, viewH: 360, x0: 52, x1: 1150, baseline: 296, topLim: 35,
};
/** 브랜드 탭 */
export const GEOM_BRAND: WaterfallGeom = {
  viewW: 1120, viewH: 460, x0: 60, x1: 1104, baseline: 352, topLim: 39,
};

interface Segment { start: number; end: number; eff?: number }

export default function Waterfall({ p0, p1, br, geom, label }: {
  p0: Totals; p1: Totals; br: BridgeResult; geom: WaterfallGeom; label: string;
}) {
  const { viewW, viewH, x0, x1, baseline, topLim } = geom;

  const op0 = p0.op ?? 0;
  const op1 = p1.op ?? 0;
  const effects = [br.vol, br.disc, br.cogs, br.vltn, br.dc, br.opx];
  const labels = ['전년', ...ITEM_ORDER.map((k) => ITEM_LABEL_SHORT[k]), '당년'];

  // 누적 구간 — 양끝은 0 기준 절대 막대
  const cum: Segment[] = [{ start: 0, end: op0 }];
  let acc = op0;
  for (const eff of effects) {
    const startY = acc;
    acc += eff;
    cum.push({ start: startY, end: acc, eff });
  }
  cum.push({ start: 0, end: op1 });

  const nBars = labels.length;   // 8
  const stepW = (x1 - x0) / nBars;
  const barW = Math.max(20, stepW * 0.55);

  // y 범위
  let ymin = 0;
  let ymax = 0;
  for (const c of cum) {
    ymin = Math.min(ymin, c.start, c.end);
    ymax = Math.max(ymax, c.start, c.end);
  }
  if (ymax === ymin) ymax = ymin + 1;

  const svgBottom = baseline;
  const posRange = baseline - topLim;
  const belowMax = Math.max(0, -ymin);
  const belowPx = belowMax > 0 ? 40 : 0;   // 음수 구간은 baseline 아래 40px 이내로 압축
  const posMax = ymax;

  const yPx = (v: number): number =>
    v >= 0
      ? svgBottom - (v / (posMax || 1)) * posRange
      : svgBottom + (Math.abs(v) / (belowMax || 1)) * belowPx;

  const gYT = yPx(posMax);

  // 막대 + 연결선
  const bars: React.ReactNode[] = [];
  const conns: React.ReactNode[] = [];
  let prevEndX: number | null = null;
  let prevEndY = 0;

  for (let i = 0; i < nBars; i++) {
    const cx = x0 + stepW * (i + 0.5);
    const bx = cx - barW / 2;
    const isTotal = i === 0 || i === nBars - 1;
    const c = cum[i];
    const yStart = yPx(c.start);
    const yEnd = yPx(c.end);
    const top = Math.min(yStart, yEnd);
    const height = Math.max(1, Math.abs(yStart - yEnd));
    const cls = isTotal ? 'bar-total' : (c.eff ?? 0) >= 0 ? 'bar-pos' : 'bar-neg';
    const rawVal = isTotal ? (i === 0 ? op0 : op1) : c.eff;

    if (prevEndX != null) {
      conns.push(
        <line key={`c${i}`} className="conn"
          x1={prevEndX.toFixed(1)} x2={bx.toFixed(1)}
          y1={prevEndY.toFixed(1)} y2={yPx(isTotal ? c.end : c.start).toFixed(1)} />,
      );
    }
    prevEndX = bx + barW;
    prevEndY = yPx(c.end);

    bars.push(
      <g key={`b${i}`}>
        <rect x={bx.toFixed(1)} y={top.toFixed(1)}
          width={barW.toFixed(1)} height={height.toFixed(1)} className={cls} />
        <text x={cx.toFixed(1)} y={(top - 6).toFixed(1)}
          className={isTotal ? 'val val-total' : 'val'} textAnchor="middle">
          {isTotal ? fmtK(rawVal) : fmtKsigned(rawVal)}
        </text>
        <text x={cx.toFixed(1)} y={(baseline + 16).toFixed(1)} className="cat" textAnchor="middle">
          {labels[i]}
        </text>
      </g>,
    );
  }

  return (
    <svg viewBox={`0 0 ${viewW} ${viewH}`} role="img" aria-label={`${label} 영업이익 Bridge 워터폴`}
      style={{ width: '100%', height: 'auto', display: 'block', fontFamily: 'inherit' }}>
      <line x1={x0} x2={x1} y1={baseline} y2={baseline} className="base" />
      <line x1={x0} x2={x1} y1={gYT} y2={gYT} className="grid" />
      <text x={x0 - 6} y={gYT + 4} className="ax" textAnchor="end">{fmtK(posMax)}</text>
      <text x={x0 - 6} y={baseline + 4} className="ax" textAnchor="end">0</text>
      {conns}
      {bars}
    </svg>
  );
}
