import { useCallback, useState } from 'react';

const LIMIT = 100;

interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

/**
 * ประวัติสำหรับ undo/redo — `commit` เก็บสถานะเดิมไว้ (เรียกครั้งเดียวต่อการกระทำ เช่น ปล่อยเมาส์หลังลาก)
 * `reset` ล้างประวัติ (หลังบันทึก/โหลดใหม่)
 */
export function useHistory<T>(initial: T) {
  const [h, setH] = useState<History<T>>({ past: [], present: initial, future: [] });

  const commit = useCallback((next: T | ((current: T) => T)) => {
    setH((prev) => {
      const value = typeof next === 'function' ? (next as (c: T) => T)(prev.present) : next;
      if (Object.is(value, prev.present)) return prev;
      return { past: [...prev.past, prev.present].slice(-LIMIT), present: value, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    setH((prev) =>
      prev.past.length === 0
        ? prev
        : {
            past: prev.past.slice(0, -1),
            present: prev.past[prev.past.length - 1]!,
            future: [prev.present, ...prev.future],
          },
    );
  }, []);

  const redo = useCallback(() => {
    setH((prev) =>
      prev.future.length === 0
        ? prev
        : {
            past: [...prev.past, prev.present],
            present: prev.future[0]!,
            future: prev.future.slice(1),
          },
    );
  }, []);

  const reset = useCallback((value: T) => setH({ past: [], present: value, future: [] }), []);

  return {
    present: h.present,
    commit,
    undo,
    redo,
    reset,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
    /** จำนวนการเปลี่ยนแปลงตั้งแต่โหลด/บันทึกล่าสุด */
    changes: h.past.length,
  };
}
