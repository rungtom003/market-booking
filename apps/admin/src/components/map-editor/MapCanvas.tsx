import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { MapZone } from '@market-booking/shared';
import { FEATURE_STYLE, featureFontSize, stallColors } from '@market-booking/stall-map';
import type Konva from 'konva';
import {
  Group,
  Image as KonvaImage,
  Layer,
  Rect,
  Shape,
  Stage,
  Text,
  Transformer,
} from 'react-konva';
import {
  type Box,
  type EditorDoc,
  type EditorFeature,
  type EditorItem,
  type EditorStall,
  boundsOf,
  itemsOf,
  snapTo,
} from './editor-model';

export interface MapCanvasHandle {
  fit: () => void;
  zoom: (factor: number) => void;
  /** จุดกลางของส่วนที่มองเห็น (หน่วยผัง) — วางสัญลักษณ์ใหม่ตรงนี้ */
  viewCenter: () => { x: number; y: number };
}

interface Props {
  doc: EditorDoc;
  zones: MapZone[];
  selected: ReadonlySet<string>;
  onSelect: (keys: Set<string>) => void;
  /** ตำแหน่ง/ขนาด/มุมใหม่ของหลายรายการพร้อมกัน (1 การกระทำ = 1 ขั้นของ undo) */
  onChange: (updates: Map<string, Box>) => void;
  grid: number;
  snap: boolean;
  height: number;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
const MIN_SIZE = 5;

interface View {
  scale: number;
  x: number;
  y: number;
}

/**
 * node ของรายการบนผังตาม key — ไม่ใช้ selector `#id` ของ Konva เพราะ UUID ขึ้นต้นด้วยตัวเลข
 * (selector แบบ CSS ต้อง escape ซึ่ง Konva ไม่รองรับ)
 */
function nodeOf(stage: Konva.Stage, key: string): Konva.Node | undefined {
  return stage.findOne((n: Konva.Node) => n.id() === key);
}

/** รูปที่โหลดเสร็จแล้วของ `url` (url เปลี่ยน = ไม่แสดงรูปเก่าระหว่างโหลดรูปใหม่) */
function useImage(url: string | undefined): HTMLImageElement | null {
  const [loaded, setLoaded] = useState<{ url: string; image: HTMLImageElement } | null>(null);
  useEffect(() => {
    if (!url) return;
    const image = new window.Image();
    image.onload = () => setLoaded({ url, image });
    image.src = url;
    return () => {
      image.onload = null;
    };
  }, [url]);
  return url && loaded?.url === url ? loaded.image : null;
}

/** เส้นกริดเฉพาะส่วนที่มองเห็น (ไม่วาดเมื่อถี่เกินจนเป็นพื้นเทา) */
function Grid({
  grid,
  view,
  width,
  height,
}: {
  grid: number;
  view: View;
  width: number;
  height: number;
}) {
  const step = grid * (grid * view.scale < 8 ? 10 : 1);
  return (
    <Shape
      listening={false}
      sceneFunc={(ctx) => {
        const x0 = Math.floor(-view.x / view.scale / step) * step;
        const y0 = Math.floor(-view.y / view.scale / step) * step;
        const x1 = (width - view.x) / view.scale;
        const y1 = (height - view.y) / view.scale;
        ctx.beginPath();
        for (let x = x0; x <= x1; x += step) {
          ctx.moveTo(x, y0);
          ctx.lineTo(x, y1);
        }
        for (let y = y0; y <= y1; y += step) {
          ctx.moveTo(x0, y);
          ctx.lineTo(x1, y);
        }
        ctx.strokeStyle = '#E2E8F0';
        ctx.lineWidth = 1 / view.scale;
        ctx.stroke();
      }}
    />
  );
}

function StallNode({
  s,
  zoneColor,
  selected,
}: {
  s: EditorStall;
  zoneColor: string;
  selected: boolean;
}) {
  const c = stallColors(s.isActive ? 'AVAILABLE' : 'INACTIVE', zoneColor, selected);
  const fontSize = Math.max(8, Math.min(s.w / (s.code.length * 0.62 + 0.8), s.h * 0.4));
  return (
    <>
      <Rect
        width={s.w}
        height={s.h}
        cornerRadius={Math.min(6, s.w / 8, s.h / 8)}
        fill={c.fill}
        stroke={s.isNew ? '#2563EB' : c.stroke}
        strokeWidth={selected ? 3 : 1.5}
        dash={s.isNew ? [6, 4] : c.dash ? c.dash.split(' ').map(Number) : undefined}
      />
      <Text
        width={s.w}
        height={s.h}
        text={s.code}
        align="center"
        verticalAlign="middle"
        fontSize={fontSize}
        fontStyle="bold"
        fill={c.text}
        listening={false}
      />
    </>
  );
}

function FeatureNode({ f, selected }: { f: EditorFeature; selected: boolean }) {
  const style = FEATURE_STYLE[f.kind];
  const center = f.kind === 'LABEL' || f.kind === 'WALKWAY' ? (f.label ?? '') : (style.glyph ?? '');
  const below = f.kind !== 'LABEL' && f.kind !== 'WALKWAY' ? f.label : null;
  const belowSize = Math.max(8, Math.min(14, f.w * 0.28));
  return (
    <>
      <Rect
        width={f.w}
        height={f.h}
        cornerRadius={f.kind === 'WALKWAY' ? 2 : Math.min(8, f.w / 5, f.h / 5)}
        fill={f.kind === 'LABEL' ? 'rgba(255,255,255,0.01)' : style.fill}
        stroke={selected ? '#2563EB' : f.kind === 'LABEL' ? '#CBD5E1' : style.stroke}
        strokeWidth={selected ? 2 : 1}
        dash={f.kind === 'LABEL' ? [4, 4] : undefined}
      />
      {center && (
        <Text
          width={f.w}
          height={f.h}
          text={center}
          align="center"
          verticalAlign="middle"
          fontSize={featureFontSize(f.w, f.h, center)}
          fontStyle="bold"
          fill={style.text}
          listening={false}
        />
      )}
      {below && (
        <Text
          y={f.h + 2}
          x={-f.w}
          width={f.w * 3}
          text={below}
          align="center"
          fontSize={belowSize}
          fill={style.text}
          listening={false}
        />
      )}
    </>
  );
}

/**
 * พื้นที่วาดของ Map Editor (Konva): คลิก/Shift-คลิก/ลากกรอบเพื่อเลือก, ลากเพื่อย้าย (ทุกชิ้นที่เลือก),
 * จุดจับเพื่อย่อ-ขยาย/หมุน, ล้อเมาส์ซูม, Space ค้าง (หรือปุ่มกลาง) ลากเลื่อนผัง
 * ค่าที่ปรับถูกส่งออกครั้งเดียวตอนปล่อยเมาส์ — snap ตามกริดถ้าเปิด
 */
export const MapCanvas = forwardRef<MapCanvasHandle, Props>(function MapCanvas(
  { doc, zones, selected, onSelect, onChange, grid, snap, height },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  /** 0 = ยังไม่ได้วัดขนาดจริง (ยังไม่วาด ไม่ fit) */
  const [width, setWidth] = useState(0);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [pan, setPan] = useState(false);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  );
  /** key ของทุกชิ้นที่กำลังลาก (ว่าง = ไม่ได้ลาก) */
  const dragging = useRef<string[]>([]);
  const fitted = useRef(false);
  const image = useImage(doc.background?.url);
  const items = itemsOf(doc);
  const zoneColor = new Map(zones.map((z) => [z.id, z.color]));

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(320, entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const b = boundsOf([
      ...itemsOf(doc),
      ...(doc.background
        ? [{ posX: 0, posY: 0, w: doc.background.width, h: doc.background.height, rot: 0 }]
        : []),
    ]) ?? { posX: 0, posY: 0, w: 800, h: 500, rot: 0 };
    const pad = 40;
    const scale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, Math.min((width - pad * 2) / b.w, (height - pad * 2) / b.h)),
    );
    setView({
      scale,
      x: (width - b.w * scale) / 2 - b.posX * scale,
      y: (height - b.h * scale) / 2 - b.posY * scale,
    });
  }, [doc, width, height]);

  // ดูทั้งผังครั้งแรกที่มีขนาดจริง
  useEffect(() => {
    if (!fitted.current && width > 0) {
      fitted.current = true;
      fit();
    }
  }, [fit, width]);

  const zoomAt = useCallback(
    (factor: number, px = width / 2, py = height / 2) => {
      setView((v) => {
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
        const k = scale / v.scale;
        return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
      });
    },
    [width, height],
  );

  useImperativeHandle(
    ref,
    () => ({
      fit,
      zoom: (factor) => zoomAt(factor),
      viewCenter: () => ({
        x: (width / 2 - view.x) / view.scale,
        y: (height / 2 - view.y) / view.scale,
      }),
    }),
    [fit, zoomAt, view, width, height],
  );

  // Space ค้าง = โหมดเลื่อนผัง (ยกเว้นกำลังพิมพ์)
  useEffect(() => {
    const typing = () => {
      const el = document.activeElement;
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !typing()) {
        e.preventDefault();
        setPan(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setPan(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Transformer จับทุกชิ้นที่เลือก
  useEffect(() => {
    const stage = stageRef.current;
    const tr = trRef.current;
    if (!stage || !tr) return;
    const nodes = [...selected]
      .map((key) => nodeOf(stage, key))
      .filter((n): n is Konva.Node => Boolean(n));
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selected, doc]);

  const byKey = new Map(items.map((i) => [i.key, i]));

  const select = (key: string, additive: boolean) => {
    if (additive) {
      const next = new Set(selected);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      onSelect(next);
    } else if (!selected.has(key)) {
      onSelect(new Set([key]));
    }
  };

  /** กล่องของ node หลังลาก/แปลง → ค่าในผัง (+ snap) และวาง node ให้ตรงค่าที่ snap แล้ว */
  const boxOf = (node: Konva.Node, item: EditorItem, resize: boolean): Box => {
    let w = item.w;
    let h = item.h;
    if (resize) {
      w = Math.max(MIN_SIZE, item.w * node.scaleX());
      h = Math.max(MIN_SIZE, item.h * node.scaleY());
      if (snap) {
        w = Math.max(grid, snapTo(w, grid));
        h = Math.max(grid, snapTo(h, grid));
      }
      node.scale({ x: 1, y: 1 });
      node.offset({ x: w / 2, y: h / 2 });
    }
    let posX = node.x() - w / 2;
    let posY = node.y() - h / 2;
    if (snap) {
      posX = snapTo(posX, grid);
      posY = snapTo(posY, grid);
    }
    node.position({ x: posX + w / 2, y: posY + h / 2 });
    return { posX, posY, w, h, rot: Math.round(node.rotation() * 100) / 100 };
  };

  /**
   * ชิ้นอื่นที่เลือกไว้ Transformer ของ Konva ลากตามให้เอง (มันเรียก startDrag ของชิ้นเหล่านั้น)
   * — ห้ามขยับซ้ำเอง ไม่งั้นชิ้นอื่นเลื่อนเกินไปเท่าระยะ dragmove แรก ผังที่จัดไว้จะเบี้ยว
   */
  const onDragStart = (key: string) => {
    // dragstart ของชิ้นที่ Transformer ลากตาม ไม่ใช่การลากใหม่
    if (dragging.current.length > 0) return;
    dragging.current = selected.has(key) ? [...selected] : [key];
    if (!selected.has(key)) onSelect(new Set([key]));
  };

  /** ทุกชิ้นที่ลากส่ง dragend มา — บันทึกครั้งแรกครั้งเดียว (1 การลาก = 1 ขั้นของ undo) */
  const onDragEnd = () => {
    if (dragging.current.length === 0) return;
    const stage = stageRef.current!;
    const updates = new Map<string, Box>();
    for (const k of dragging.current) {
      const node = nodeOf(stage, k);
      const item = byKey.get(k);
      if (node && item) updates.set(k, boxOf(node, item, false));
    }
    dragging.current = [];
    onChange(updates);
  };

  /**
   * ผูกกับ Transformer (ยิงครั้งเดียว) ไม่ใช่กับแต่ละชิ้น — Konva ยิง transformend ให้ทุกชิ้นที่เลือก
   * ครั้งที่สองเป็นต้นไปจะเห็น scale = 1 (รีเซ็ตแล้ว) กับขนาดเดิมจาก render ก่อน → ขนาดเด้งกลับและตำแหน่งเลื่อน
   */
  const onTransformEnd = () => {
    const updates = new Map<string, Box>();
    for (const node of trRef.current?.nodes() ?? []) {
      const item = byKey.get(node.id());
      if (item) updates.set(item.key, boxOf(node, item, true));
    }
    onChange(updates);
  };

  const pointer = () => stageRef.current?.getRelativePointerPosition() ?? { x: 0, y: 0 };
  const onEmpty = (e: Konva.KonvaEventObject<MouseEvent>) =>
    e.target === stageRef.current || e.target.name() === 'background';

  const renderItem = (item: EditorItem) => {
    const isSelected = selected.has(item.key);
    return (
      <Group
        key={item.key}
        id={item.key}
        name="item"
        x={item.posX + item.w / 2}
        y={item.posY + item.h / 2}
        offsetX={item.w / 2}
        offsetY={item.h / 2}
        rotation={item.rot}
        draggable={!pan}
        onMouseDown={(e) => {
          if (e.evt.button !== 0) return;
          e.cancelBubble = true;
          select(item.key, e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey);
        }}
        onTap={() => select(item.key, false)}
        onDragStart={() => onDragStart(item.key)}
        onDragEnd={onDragEnd}
      >
        {item.type === 'stall' ? (
          <StallNode
            s={item}
            zoneColor={zoneColor.get(item.zoneId) ?? '#64748B'}
            selected={isSelected}
          />
        ) : (
          <FeatureNode f={item} selected={isSelected} />
        )}
      </Group>
    );
  };

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label="พื้นที่แก้ไขผังตลาด"
      // พิกัดจอ ↔ ผัง: จอ = ผัง × scale + (x, y) — ใช้ใน E2E และ debug
      data-scale={view.scale}
      data-x={view.x}
      data-y={view.y}
      style={{
        width: '100%',
        height,
        background: '#F8FAFC',
        cursor: pan ? 'grab' : 'default',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      {width > 0 && (
        <Stage
          ref={stageRef}
          width={width}
          height={height}
          scaleX={view.scale}
          scaleY={view.scale}
          x={view.x}
          y={view.y}
          draggable={pan}
          onDragEnd={(e) => {
            if (e.target === stageRef.current)
              setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }));
          }}
          onWheel={(e) => {
            e.evt.preventDefault();
            const p = stageRef.current?.getPointerPosition();
            zoomAt(e.evt.deltaY < 0 ? 1.15 : 1 / 1.15, p?.x, p?.y);
          }}
          onMouseDown={(e) => {
            if (pan || e.evt.button !== 0 || !onEmpty(e)) return;
            const p = pointer();
            setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
          }}
          onMouseMove={() => {
            if (!marquee) return;
            const p = pointer();
            setMarquee((m) => m && { ...m, x1: p.x, y1: p.y });
          }}
          onMouseUp={(e) => {
            if (!marquee) return;
            const x = Math.min(marquee.x0, marquee.x1);
            const y = Math.min(marquee.y0, marquee.y1);
            const w = Math.abs(marquee.x1 - marquee.x0);
            const h = Math.abs(marquee.y1 - marquee.y0);
            setMarquee(null);
            const additive = e.evt.shiftKey;
            // แทบไม่ได้ลาก = คลิกที่ว่าง → ยกเลิกการเลือก
            if (w * view.scale < 4 && h * view.scale < 4) {
              if (!additive) onSelect(new Set());
              return;
            }
            const hit = items
              .filter(
                (i) => i.posX < x + w && i.posX + i.w > x && i.posY < y + h && i.posY + i.h > y,
              )
              .map((i) => i.key);
            onSelect(new Set([...(additive ? selected : []), ...hit]));
          }}
          onContextMenu={(e) => e.evt.preventDefault()}
        >
          <Layer>
            {image && doc.background && (
              <KonvaImage
                name="background"
                image={image}
                x={0}
                y={0}
                width={doc.background.width}
                height={doc.background.height}
                opacity={0.55}
              />
            )}
            {snap && <Grid grid={grid} view={view} width={width} height={height} />}
          </Layer>
          <Layer>
            {doc.features.map(renderItem)}
            {doc.stalls.map(renderItem)}
            <Transformer
              ref={trRef}
              keepRatio={false}
              rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
              rotationSnapTolerance={6}
              ignoreStroke
              onTransformEnd={onTransformEnd}
              boundBoxFunc={(oldBox, newBox) =>
                Math.abs(newBox.width) < MIN_SIZE || Math.abs(newBox.height) < MIN_SIZE
                  ? oldBox
                  : newBox
              }
            />
            {marquee && (
              <Rect
                x={Math.min(marquee.x0, marquee.x1)}
                y={Math.min(marquee.y0, marquee.y1)}
                width={Math.abs(marquee.x1 - marquee.x0)}
                height={Math.abs(marquee.y1 - marquee.y0)}
                fill="rgba(37,99,235,0.08)"
                stroke="#2563EB"
                strokeWidth={1 / view.scale}
                dash={[4 / view.scale, 4 / view.scale]}
                listening={false}
              />
            )}
          </Layer>
        </Stage>
      )}
    </div>
  );
});
