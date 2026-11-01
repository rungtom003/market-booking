import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ALLOWED_IMAGE_TYPES,
  MAP_FEATURE_KINDS,
  MAP_FEATURE_TH,
  MAX_UPLOAD_BYTES,
  type AdminMapLayout,
  type MapFeatureKind,
  type MapZone,
} from '@market-booking/shared';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import FitScreenIcon from '@mui/icons-material/FitScreen';
import RedoIcon from '@mui/icons-material/Redo';
import UndoIcon from '@mui/icons-material/Undo';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { adminApi } from '../api/admin';
import { MapCanvas, type MapCanvasHandle } from '../components/map-editor/MapCanvas';
import {
  type Box as ItemBox,
  type EditorDoc,
  type EditorFeature,
  type EditorItem,
  type EditorStall,
  NEW_FEATURE_SIZE,
  docFromLayout,
  itemsOf,
  newKey,
  nextFreeCode,
  snapTo,
  toSaveInput,
} from '../components/map-editor/editor-model';
import { useHistory } from '../components/map-editor/useHistory';
import { errorCode, errorMessage } from '../lib/errors';

const EMPTY: EditorDoc = { stalls: [], features: [], background: null };
const PASTE_OFFSET = 20;

function isTyping(): boolean {
  const el = document.activeElement;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}

/** แก้ทีละรายการตาม key — คืน doc ใหม่ (immutable) */
function updateItems(doc: EditorDoc, updates: Map<string, Partial<EditorItem>>): EditorDoc {
  if (updates.size === 0) return doc;
  return {
    ...doc,
    stalls: doc.stalls.map((s) =>
      updates.has(s.key) ? ({ ...s, ...updates.get(s.key) } as EditorStall) : s,
    ),
    features: doc.features.map((f) =>
      updates.has(f.key) ? ({ ...f, ...updates.get(f.key) } as EditorFeature) : f,
    ),
  };
}

/** ช่องตัวเลขที่บันทึกเมื่อออกจากช่อง/กด Enter (1 ครั้ง = 1 ขั้นของ undo) */
function NumberField({
  label,
  value,
  onCommit,
  min,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  min?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  // ค่าเปลี่ยนจากที่อื่น (ลากบนผัง, undo) → แสดงค่าใหม่ (ปรับ state ระหว่าง render ตามแนวทางของ React)
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(String(Math.round(value * 100) / 100));
  }
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && (min === undefined || n >= min) && n !== value) onCommit(n);
    else setDraft(String(Math.round(value * 100) / 100));
  };
  return (
    <TextField
      label={label}
      size="small"
      type="number"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function Inspector({
  doc,
  selected,
  zones,
  onUpdate,
  onDelete,
  onBackground,
  onBackgroundSize,
  onRemoveBackground,
  uploading,
}: {
  doc: EditorDoc;
  selected: EditorItem[];
  zones: MapZone[];
  onUpdate: (key: string, patch: Partial<EditorItem>) => void;
  onDelete: () => void;
  onBackground: (file: File) => void;
  onBackgroundSize: (width: number) => void;
  onRemoveBackground: () => void;
  uploading: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const one = selected.length === 1 ? selected[0]! : null;

  if (one) {
    const box = (patch: Partial<ItemBox>) => onUpdate(one.key, patch);
    return (
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {one.type === 'stall' ? `ล็อค ${one.code}` : MAP_FEATURE_TH[one.kind]}
          {one.type === 'stall' && one.isNew && ' (ใหม่)'}
        </Typography>
        {one.type === 'stall' && !one.isActive && (
          <Alert severity="info">ล็อคนี้ปิดใช้งาน — ผู้ค้าไม่เห็นบนผัง</Alert>
        )}
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
          <NumberField label="X" value={one.posX} min={0} onCommit={(v) => box({ posX: v })} />
          <NumberField label="Y" value={one.posY} min={0} onCommit={(v) => box({ posY: v })} />
          <NumberField label="กว้าง" value={one.w} min={1} onCommit={(v) => box({ w: v })} />
          <NumberField label="สูง" value={one.h} min={1} onCommit={(v) => box({ h: v })} />
          <NumberField label="หมุน (องศา)" value={one.rot} onCommit={(v) => box({ rot: v })} />
        </Box>
        {one.type === 'feature' && (
          <TextField
            label={one.kind === 'LABEL' ? 'ข้อความ' : 'ป้ายกำกับ (ไม่บังคับ)'}
            size="small"
            defaultValue={one.label ?? ''}
            key={one.key}
            slotProps={{ htmlInput: { maxLength: 100 } }}
            onBlur={(e) => {
              const label = e.target.value.trim() || null;
              if (label !== one.label) onUpdate(one.key, { label });
            }}
          />
        )}
        {one.type === 'stall' && one.isNew && (
          <>
            <TextField
              label="รหัสล็อค"
              size="small"
              defaultValue={one.code}
              key={`${one.key}-code`}
              onBlur={(e) => {
                const code = e.target.value.trim().toUpperCase();
                if (code && code !== one.code) onUpdate(one.key, { code });
              }}
            />
            <TextField
              select
              label="โซน"
              size="small"
              value={one.zoneId}
              onChange={(e) => onUpdate(one.key, { zoneId: e.target.value })}
            >
              {zones.map((z) => (
                <MenuItem key={z.id} value={z.id}>
                  {z.name}
                </MenuItem>
              ))}
            </TextField>
            <NumberField
              label="ราคา (บาท)"
              value={one.price}
              min={0}
              onCommit={(v) => onUpdate(one.key, { price: v })}
            />
          </>
        )}
        {one.type === 'stall' && !one.isNew && (
          <Typography variant="body2" color="text.secondary">
            แก้รหัส/ราคา/โซน ที่หน้า "ล็อคและผังตลาด"
          </Typography>
        )}
        {(one.type === 'feature' || one.isNew) && (
          <Button color="error" variant="outlined" onClick={onDelete}>
            ลบ
          </Button>
        )}
      </Stack>
    );
  }

  if (selected.length > 1) {
    const removable = selected.filter((i) => i.type === 'feature' || i.isNew).length;
    return (
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          เลือก {selected.length} รายการ
        </Typography>
        <Typography variant="body2" color="text.secondary">
          ลากเพื่อย้ายพร้อมกัน · Ctrl+C / Ctrl+V คัดลอก · ลูกศรขยับทีละ 1 (Shift = 10)
        </Typography>
        {removable > 0 && (
          <Button color="error" variant="outlined" onClick={onDelete}>
            ลบ {removable} รายการ
          </Button>
        )}
      </Stack>
    );
  }

  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        รูปแปลนตลาด (พื้นหลัง)
      </Typography>
      {doc.background ? (
        <>
          <NumberField
            label="ความกว้างบนผัง"
            value={doc.background.width}
            min={10}
            onCommit={onBackgroundSize}
          />
          <Typography variant="body2" color="text.secondary">
            สูง {Math.round(doc.background.height)} (ตามสัดส่วนรูป)
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button size="small" onClick={() => fileRef.current?.click()} loading={uploading}>
              เปลี่ยนรูป
            </Button>
            <Button size="small" color="error" onClick={onRemoveBackground}>
              เอาออก
            </Button>
          </Stack>
        </>
      ) : (
        <Button variant="outlined" onClick={() => fileRef.current?.click()} loading={uploading}>
          ใส่รูปแปลนตลาด
        </Button>
      )}
      <input
        ref={fileRef}
        type="file"
        hidden
        aria-label="รูปแปลนตลาด"
        accept={ALLOWED_IMAGE_TYPES.join(',')}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onBackground(file);
        }}
      />
      <Divider />
      <Typography variant="subtitle2">วิธีใช้</Typography>
      <Typography variant="body2" color="text.secondary" component="div">
        คลิกเลือก · Shift+คลิก / ลากกรอบ เลือกหลายอัน · ลากย้าย · จุดจับรอบกรอบ ย่อ-ขยาย/หมุน ·
        ล้อเมาส์ ซูม · กด Space ค้างแล้วลาก เลื่อนผัง · Ctrl+Z / Ctrl+Y ย้อน/ทำซ้ำ · Delete
        ลบสัญลักษณ์
      </Typography>
    </Stack>
  );
}

/** Map Editor (Phase 9.1) — ผังทั้งชุดแก้ในหน้านี้แล้วบันทึกครั้งเดียว */
export function MapEditorPage() {
  const queryClient = useQueryClient();
  const layout = useQuery({ queryKey: ['map-layout'], queryFn: adminApi.stalls.layout });
  const history = useHistory<EditorDoc>(EMPTY);
  const [version, setVersion] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [snap, setSnap] = useState(true);
  const [grid, setGrid] = useState(10);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; outdated: boolean } | null>(null);
  const [uploading, setUploading] = useState(false);
  const canvas = useRef<MapCanvasHandle>(null);
  const clipboard = useRef<EditorItem[]>([]);
  const pasteCount = useRef(0);
  const doc = history.present;

  const { reset } = history;
  const load = useCallback(
    (data: AdminMapLayout) => {
      reset(docFromLayout(data));
      setVersion(data.version);
      setSelected(new Set());
    },
    [reset],
  );

  // โหลดครั้งแรก (ครั้งต่อไปโหลดผ่านปุ่ม/หลังบันทึก — ไม่ทับงานที่กำลังแก้)
  if (layout.data && version === null) load(layout.data);

  const items = useMemo(() => itemsOf(doc), [doc]);
  const selectedItems = items.filter((i) => selected.has(i.key));

  // เตือนก่อนปิดแท็บเมื่อยังไม่บันทึก
  useEffect(() => {
    if (history.changes === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [history.changes]);

  const commitUpdates = (updates: Map<string, Partial<EditorItem>>) =>
    history.commit((d) => updateItems(d, updates));

  const addFeature = (kind: MapFeatureKind) => {
    const size = NEW_FEATURE_SIZE[kind];
    const c = canvas.current?.viewCenter() ?? { x: 100, y: 100 };
    const feature: EditorFeature = {
      key: newKey(),
      type: 'feature',
      kind,
      label: kind === 'LABEL' ? 'ข้อความ' : null,
      posX: Math.max(0, snapTo(c.x - size.w / 2, snap ? grid : 0)),
      posY: Math.max(0, snapTo(c.y - size.h / 2, snap ? grid : 0)),
      w: size.w,
      h: size.h,
      rot: 0,
    };
    // ทางเดินอยู่ล่างสุด สัญลักษณ์อื่นอยู่บน
    history.commit((d) => ({
      ...d,
      features: kind === 'WALKWAY' ? [feature, ...d.features] : [...d.features, feature],
    }));
    setSelected(new Set([feature.key]));
  };

  const deleteSelected = useCallback(() => {
    const removable = new Set(
      itemsOf(history.present)
        .filter((i) => selected.has(i.key) && (i.type === 'feature' || i.isNew))
        .map((i) => i.key),
    );
    if (removable.size < selected.size) {
      setNotice('ล็อคที่มีอยู่แล้วลบที่หน้า "ล็อคและผังตลาด" (ลบได้เฉพาะที่ไม่เคยมีการจอง)');
    }
    if (removable.size === 0) return;
    history.commit((d) => ({
      ...d,
      stalls: d.stalls.filter((s) => !removable.has(s.key)),
      features: d.features.filter((f) => !removable.has(f.key)),
    }));
    setSelected((s) => new Set([...s].filter((k) => !removable.has(k))));
  }, [history, selected]);

  const copy = useCallback(() => {
    clipboard.current = itemsOf(history.present).filter((i) => selected.has(i.key));
    pasteCount.current = 0;
  }, [history.present, selected]);

  /** วางที่เดิมเลื่อนลงขวา — ล็อคได้รหัสถัดไปที่ยังว่าง (A10 → A11) และเป็นล็อคใหม่ */
  const paste = useCallback(() => {
    if (clipboard.current.length === 0) return;
    pasteCount.current += 1;
    const offset = PASTE_OFFSET * pasteCount.current;
    const taken = new Set(history.present.stalls.map((s) => s.code));
    const copies = clipboard.current.map((item): EditorItem => {
      const at = { key: newKey(), posX: item.posX + offset, posY: item.posY + offset };
      if (item.type !== 'stall') return { ...item, ...at };
      const code = nextFreeCode(item.code, taken);
      taken.add(code);
      return { ...item, ...at, code, isNew: true, isActive: true };
    });
    history.commit((d) => ({
      ...d,
      stalls: [...d.stalls, ...copies.filter((c): c is EditorStall => c.type === 'stall')],
      features: [...d.features, ...copies.filter((c): c is EditorFeature => c.type === 'feature')],
    }));
    setSelected(new Set(copies.map((c) => c.key)));
  }, [history]);

  const nudge = useCallback(
    (dx: number, dy: number) => {
      const updates = new Map<string, Partial<EditorItem>>();
      for (const i of itemsOf(history.present)) {
        if (selected.has(i.key)) {
          updates.set(i.key, { posX: Math.max(0, i.posX + dx), posY: Math.max(0, i.posY + dy) });
        }
      }
      history.commit((d) => updateItems(d, updates));
    },
    [history, selected],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping()) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        history.redo();
      } else if (mod && key === 'c') {
        copy();
      } else if (mod && key === 'v') {
        e.preventDefault();
        paste();
      } else if (mod && key === 'a') {
        e.preventDefault();
        setSelected(new Set(itemsOf(history.present).map((i) => i.key)));
      } else if (key === 'delete' || key === 'backspace') {
        if (selected.size > 0) {
          e.preventDefault();
          deleteSelected();
        }
      } else if (key === 'escape') {
        setSelected(new Set());
      } else if (key.startsWith('arrow') && selected.size > 0) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        nudge(
          key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0,
          key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0,
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history, selected, copy, paste, deleteSelected, nudge]);

  const save = useMutation({
    mutationFn: () => adminApi.stalls.saveLayout(toSaveInput(history.present, version ?? 0)),
    onSuccess: (data) => {
      load(data);
      queryClient.setQueryData(['map-layout'], data);
      void queryClient.invalidateQueries({ queryKey: ['stalls'] });
      setError(null);
      setNotice('บันทึกผังแล้ว');
    },
    onError: (e) =>
      setError({ text: errorMessage(e), outdated: errorCode(e) === 'LAYOUT_OUTDATED' }),
  });

  const reload = async () => {
    const res = await layout.refetch();
    if (res.data) load(res.data);
    setError(null);
  };

  const uploadBackground = async (file: File) => {
    if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setNotice('ใช้ได้เฉพาะรูป JPEG, PNG หรือ WebP');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setNotice('รูปต้องไม่เกิน 5 MB');
      return;
    }
    setUploading(true);
    try {
      const url = URL.createObjectURL(file);
      const size = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const img = new window.Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => reject(new Error('อ่านรูปไม่ได้'));
        img.src = url;
      });
      const ticket = await adminApi.stalls.backgroundUpload({
        contentType: file.type as (typeof ALLOWED_IMAGE_TYPES)[number],
        size: file.size,
      });
      const res = await fetch(ticket.url, {
        method: ticket.method,
        headers: ticket.headers,
        body: file,
      });
      if (!res.ok) throw new Error(`อัปโหลดไม่สำเร็จ (HTTP ${res.status})`);
      // ขนาดเริ่มต้น: เท่ารูปจริง แต่กว้างไม่เกิน 4000 (รูปจากกล้องใหญ่มาก)
      const width = Math.min(size.w, 4000);
      history.commit((d) => ({
        ...d,
        background: { key: ticket.key, url, width, height: (size.h * width) / size.w },
      }));
      setNotice('ใส่รูปแปลนแล้ว — กดบันทึกเพื่อใช้จริง');
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  if (layout.isPending) return <LinearProgress />;
  if (layout.isError) return <Alert severity="error">{errorMessage(layout.error)}</Alert>;

  const stallCount = doc.stalls.length;
  const newCount = doc.stalls.filter((s) => s.isNew).length;

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
        <IconButton component={Link} to="/stalls" aria-label="กลับไปหน้าล็อคและผังตลาด">
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700, mr: 'auto' }}>
          แก้ไขผังตลาด
        </Typography>
        <Button disabled={history.changes === 0 || save.isPending} onClick={() => void reload()}>
          ยกเลิกการแก้ไข
        </Button>
        <Button
          variant="contained"
          disabled={history.changes === 0}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          บันทึกผัง
        </Button>
      </Stack>

      {error && (
        <Alert
          severity="error"
          onClose={() => setError(null)}
          action={
            error.outdated ? (
              <Button color="inherit" size="small" onClick={() => void reload()}>
                โหลดผังล่าสุด
              </Button>
            ) : undefined
          }
        >
          {error.text}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 1 }}>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>
            เพิ่ม:
          </Typography>
          {MAP_FEATURE_KINDS.map((kind) => (
            <Button key={kind} size="small" variant="outlined" onClick={() => addFeature(kind)}>
              {MAP_FEATURE_TH[kind]}
            </Button>
          ))}
          <Divider orientation="vertical" flexItem />
          <Tooltip title="ย้อนกลับ (Ctrl+Z)">
            <span>
              <IconButton aria-label="ย้อนกลับ" disabled={!history.canUndo} onClick={history.undo}>
                <UndoIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="ทำซ้ำ (Ctrl+Y)">
            <span>
              <IconButton aria-label="ทำซ้ำ" disabled={!history.canRedo} onClick={history.redo}>
                <RedoIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Divider orientation="vertical" flexItem />
          <FormControlLabel
            control={<Switch checked={snap} onChange={(e) => setSnap(e.target.checked)} />}
            label="ดูดเข้ากริด"
          />
          <TextField
            select
            size="small"
            label="กริด"
            value={grid}
            onChange={(e) => setGrid(Number(e.target.value))}
            sx={{ width: 90 }}
          >
            {[5, 10, 20, 50].map((g) => (
              <MenuItem key={g} value={g}>
                {g}
              </MenuItem>
            ))}
          </TextField>
          <Box sx={{ ml: 'auto' }}>
            <IconButton aria-label="ซูมเข้า" onClick={() => canvas.current?.zoom(1.25)}>
              <ZoomInIcon />
            </IconButton>
            <IconButton aria-label="ซูมออก" onClick={() => canvas.current?.zoom(0.8)}>
              <ZoomOutIcon />
            </IconButton>
            <IconButton aria-label="ดูทั้งผัง" onClick={() => canvas.current?.fit()}>
              <FitScreenIcon />
            </IconButton>
          </Box>
        </Stack>
      </Paper>

      {/* minmax(0, …) + minWidth 0: canvas ของ Konva กว้างตามที่วัดได้ ไม่ดันคอลัมน์ให้ล้นจอ */}
      <Box
        sx={{
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) 300px' },
        }}
      >
        <Paper variant="outlined" sx={{ p: 0.5, minWidth: 0, overflow: 'hidden' }}>
          <MapCanvas
            ref={canvas}
            doc={doc}
            zones={layout.data.zones}
            selected={selected}
            onSelect={setSelected}
            onChange={(updates) => commitUpdates(updates)}
            grid={grid}
            snap={snap}
            height={620}
          />
        </Paper>
        <Paper variant="outlined" sx={{ p: 2 }} aria-label="คุณสมบัติ">
          <Inspector
            doc={doc}
            selected={selectedItems}
            zones={layout.data.zones}
            onUpdate={(key, patch) => commitUpdates(new Map([[key, patch]]))}
            onDelete={deleteSelected}
            onBackground={(file) => void uploadBackground(file)}
            onBackgroundSize={(width) =>
              history.commit((d) =>
                d.background
                  ? {
                      ...d,
                      background: {
                        ...d.background,
                        width,
                        height: (d.background.height * width) / d.background.width,
                      },
                    }
                  : d,
              )
            }
            onRemoveBackground={() => history.commit((d) => ({ ...d, background: null }))}
            uploading={uploading}
          />
        </Paper>
      </Box>

      <Typography variant="body2" color="text.secondary" role="status">
        ล็อค {stallCount}
        {newCount > 0 && ` (ใหม่ ${newCount})`} · สัญลักษณ์ {doc.features.length} ·{' '}
        {history.changes > 0 ? `ยังไม่บันทึก ${history.changes} การเปลี่ยนแปลง` : 'บันทึกแล้ว'}
      </Typography>

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={4000}
        onClose={() => setNotice(null)}
        message={notice}
      />
    </Stack>
  );
}
