import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { type StallShape, type ViewBox, fitViewBox, zoomAt } from './geometry';
import { STALL_STATUS_LABEL_TH, type StallMapStatus, stallColors } from './status';

export interface StallMapItem extends StallShape {
  id: string;
  code: string;
  zoneId: string;
  status: StallMapStatus;
}

export interface StallMapZone {
  id: string;
  name: string;
  color: string;
}

export interface StallMapProps {
  stalls: StallMapItem[];
  zones: StallMapZone[];
  selectedId?: string | null;
  /** ไม่ส่ง = ผังสำหรับดูอย่างเดียว */
  onSelect?: (stall: StallMapItem) => void;
  /** ค่าเริ่มต้น: เลือกได้ทุกล็อคเมื่อมี `onSelect` */
  isSelectable?: (stall: StallMapItem) => boolean;
  /** ชื่อสำหรับ screen reader / E2E — ค่าเริ่มต้น "ล็อค A1 ว่าง" */
  describe?: (stall: StallMapItem) => string;
  /** ไม่ระบุ = สูงตามสัดส่วนของผัง (อย่างน้อย 220px ไม่เกิน 70vh) */
  height?: CSSProperties['height'];
  ariaLabel?: string;
}

/** ระยะลาก (px) ที่ถือว่าเป็นการเลื่อนผัง ไม่ใช่การแตะเลือกล็อค */
const TAP_SLOP = 6;
const MAX_ZOOM = 10;
const BUTTON_ZOOM = 1.4;
const WHEEL_ZOOM = 1.15;

const defaultDescribe = (s: StallMapItem) => `ล็อค ${s.code} ${STALL_STATUS_LABEL_TH[s.status]}`;

/**
 * ผังตลาดแบบ SVG วาดจาก pos/shape ของล็อค (หน่วย px ของ canvas)
 * ลากเพื่อเลื่อน, pinch/ล้อเมาส์/ปุ่มเพื่อซูม — ผังรีเซ็ตเมื่อกรอบของล็อคเปลี่ยน
 */
export function StallMap({
  stalls,
  zones,
  selectedId,
  onSelect,
  isSelectable,
  describe = defaultDescribe,
  height,
  ariaLabel = 'ผังตลาด',
}: StallMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const fit = fitViewBox(stalls);
  const fitKey = `${fit.x},${fit.y},${fit.w},${fit.h}`;
  const [view, setView] = useState({ key: fitKey, fit, vb: fit });
  // ล็อคเปลี่ยน (เพิ่ม/ย้าย) → กลับไปดูทั้งผัง (ปรับ state ระหว่าง render ตามแนวทางของ React)
  if (view.key !== fitKey) setView({ key: fitKey, fit, vb: fit });
  const vb = view.key === fitKey ? view.vb : fit;

  /** `fn` ได้ viewBox ปัจจุบัน + ขอบเขตการซูม (ซูมเข้าได้ MAX_ZOOM เท่า, ออกได้ 2 เท่าของทั้งผัง) */
  const update = useCallback(
    (fn: (vb: ViewBox, limits: { minW: number; maxW: number }) => ViewBox) => {
      setView((v) => ({
        ...v,
        vb: fn(v.vb, { minW: v.fit.w / MAX_ZOOM, maxW: v.fit.w * 2 }),
      }));
    },
    [],
  );

  /** พิกัดจอ → พิกัดผัง (ใช้ CTM จริงของ SVG จึงถูกต้องแม้ preserveAspectRatio เว้นขอบ) */
  const toSvg = useCallback((clientX: number, clientY: number) => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    return new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  }, []);

  const zoomAround = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      update((v, limits) => {
        const p = clientX !== undefined && clientY !== undefined ? toSvg(clientX, clientY) : null;
        const px = p?.x ?? v.x + v.w / 2;
        const py = p?.y ?? v.y + v.h / 2;
        return zoomAt(v, factor, px, py, limits);
      });
    },
    [toSvg, update],
  );

  // wheel ต้องเป็น non-passive ถึงจะกันหน้าเลื่อนได้ — React ผูกแบบ passive จึงผูกเอง
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAround(e.deltaY < 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM, e.clientX, e.clientY);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [zoomAround]);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ startX: 0, startY: 0, dragged: false });

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      gesture.current = { startX: e.clientX, startY: e.clientY, dragged: false };
    } else {
      gesture.current.dragged = true; // นิ้วที่สอง = pinch ไม่ใช่การแตะ
    }
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    const g = gesture.current;
    if (!g.dragged && Math.hypot(next.x - g.startX, next.y - g.startY) > TAP_SLOP) {
      g.dragged = true;
    }

    if (pointers.current.size === 1) {
      if (g.dragged) {
        const a = toSvg(prev.x, prev.y);
        const b = toSvg(next.x, next.y);
        if (a && b) update((v) => ({ ...v, x: v.x - (b.x - a.x), y: v.y - (b.y - a.y) }));
      }
    } else if (pointers.current.size === 2) {
      const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)?.[1];
      if (other) {
        const before = Math.hypot(prev.x - other.x, prev.y - other.y);
        const after = Math.hypot(next.x - other.x, next.y - other.y);
        if (before > 0 && after > 0) {
          zoomAround(after / before, (next.x + other.x) / 2, (next.y + other.y) / 2);
        }
      }
    }
    pointers.current.set(e.pointerId, next);
  };

  const onPointerEnd = (e: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
  };

  const selectable = (s: StallMapItem) => !!onSelect && (isSelectable?.(s) ?? true);
  const zoneColor = new Map(zones.map((z) => [z.id, z.color]));

  const choose = (s: StallMapItem) => {
    if (selectable(s)) onSelect?.(s);
  };
  const onKey = (e: KeyboardEvent<SVGGElement>, s: StallMapItem) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(s);
    }
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        ...(height !== undefined
          ? { height }
          : { aspectRatio: `${fit.w} / ${fit.h}`, minHeight: 220, maxHeight: '70vh' }),
      }}
    >
      <svg
        ref={svgRef}
        role="group"
        aria-label={ariaLabel}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        width="100%"
        height="100%"
        style={{
          display: 'block',
          touchAction: 'none',
          userSelect: 'none',
          background: '#F8FAFC',
          borderRadius: 8,
          border: '1px solid #E2E8F0',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={onPointerEnd}
      >
        {stalls.map((s) => {
          const selected = s.id === selectedId;
          const canSelect = selectable(s);
          const c = stallColors(s.status, zoneColor.get(s.zoneId) ?? '#64748B', selected);
          const cx = s.posX + s.shapeW / 2;
          const cy = s.posY + s.shapeH / 2;
          return (
            <g
              key={s.id}
              data-stall-id={s.id}
              data-stall-code={s.code}
              data-status={s.status}
              transform={s.rot ? `rotate(${s.rot} ${cx} ${cy})` : undefined}
              role={canSelect ? 'button' : 'img'}
              aria-label={describe(s)}
              aria-pressed={canSelect ? selected : undefined}
              tabIndex={canSelect ? 0 : undefined}
              style={{ cursor: canSelect ? 'pointer' : 'default', outline: 'none' }}
              onClick={() => {
                // ลากผังแล้วปล่อยบนล็อค ไม่นับเป็นการเลือก
                if (!gesture.current.dragged) choose(s);
              }}
              onKeyDown={(e) => onKey(e, s)}
            >
              <rect
                x={s.posX}
                y={s.posY}
                width={s.shapeW}
                height={s.shapeH}
                rx={Math.min(6, s.shapeW / 8, s.shapeH / 8)}
                fill={c.fill}
                stroke={c.stroke}
                strokeWidth={selected ? 3 : 1.5}
                strokeDasharray={c.dash}
              />
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={Math.max(
                  8,
                  Math.min(s.shapeW / (s.code.length * 0.62 + 0.8), s.shapeH * 0.4),
                )}
                fontWeight={600}
                fontFamily="inherit"
                fill={c.text}
                style={{ pointerEvents: 'none' }}
              >
                {s.code}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ position: 'absolute', right: 8, bottom: 8, display: 'flex', gap: 4 }}>
        <MapButton label="ซูมเข้า" onClick={() => zoomAround(BUTTON_ZOOM)}>
          +
        </MapButton>
        <MapButton label="ซูมออก" onClick={() => zoomAround(1 / BUTTON_ZOOM)}>
          −
        </MapButton>
        <MapButton label="ดูทั้งผัง" onClick={() => setView({ key: fitKey, fit, vb: fit })}>
          ⤢
        </MapButton>
      </div>
    </div>
  );
}

function MapButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        width: 36,
        height: 36,
        borderRadius: 8,
        border: '1px solid #CBD5E1',
        background: '#FFFFFF',
        color: '#0F172A',
        fontSize: 18,
        lineHeight: 1,
        cursor: 'pointer',
        boxShadow: '0 1px 2px rgb(15 23 42 / 0.1)',
      }}
    >
      {children}
    </button>
  );
}
