import { MAP_FEATURE_TH, type MapFeature } from '@market-booking/shared';
import { FEATURE_STYLE, featureFontSize } from './features';

/** ทางเดิน/สัญลักษณ์/ข้อความ 1 ชิ้นบนผัง (SVG) — อยู่ใต้ล็อค ไม่รับการคลิก */
export function FeatureShape({ feature: f }: { feature: MapFeature }) {
  const style = FEATURE_STYLE[f.kind];
  const cx = f.posX + f.width / 2;
  const cy = f.posY + f.height / 2;
  const name = MAP_FEATURE_TH[f.kind];
  // ทางเดินใส่ป้ายไว้กลางแถบ, สัญลักษณ์ใส่ glyph กลางป้ายและชื่อใต้ป้าย, ข้อความแสดงข้อความ
  const center = f.kind === 'LABEL' || f.kind === 'WALKWAY' ? (f.label ?? '') : (style.glyph ?? '');
  const below = f.kind !== 'LABEL' && f.kind !== 'WALKWAY' ? f.label : null;
  const belowSize = Math.max(8, Math.min(14, f.width * 0.28));
  return (
    <g
      data-feature-kind={f.kind}
      role="img"
      aria-label={f.label ? `${name}: ${f.label}` : name}
      transform={f.rot ? `rotate(${f.rot} ${cx} ${cy})` : undefined}
      style={{ pointerEvents: 'none' }}
    >
      {f.kind !== 'LABEL' && (
        <rect
          x={f.posX}
          y={f.posY}
          width={f.width}
          height={f.height}
          rx={f.kind === 'WALKWAY' ? 2 : Math.min(8, f.width / 5, f.height / 5)}
          fill={style.fill}
          stroke={style.stroke}
          strokeWidth={f.kind === 'WALKWAY' ? 1 : 1.5}
        />
      )}
      {center && (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={featureFontSize(f.width, f.height, center)}
          fontWeight={f.kind === 'LABEL' ? 600 : 700}
          fontFamily="inherit"
          fill={style.text}
        >
          {center}
        </text>
      )}
      {below && (
        <text
          x={cx}
          y={f.posY + f.height + belowSize * 0.9}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={belowSize}
          fontFamily="inherit"
          fill={style.text}
        >
          {below}
        </text>
      )}
    </g>
  );
}
