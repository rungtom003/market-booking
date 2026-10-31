import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorCode, SOCKET_NAMESPACE, SocketEvent } from '@market-booking/shared';
import type { StallUpdatedPayload } from '@market-booking/shared';
import { type Socket, io } from 'socket.io-client';
import { MY_BOOKINGS_KEY } from '../api/booking';
import { type MarketDayStallsData, marketDayKey } from '../api/market';
import { refreshAccessToken } from './api-client';
import { session } from './session';

/**
 * socket เดียวของแอปผู้ค้า (Overview §10) — ต่อเมื่อมีหน้าที่ใช้ครั้งแรก, ปิดเมื่อ logout
 * event แค่บอกว่ามีการเปลี่ยนแปลง ข้อมูลจริงยังมาจาก REST (refetch ตอนต่อใหม่ทุกครั้ง)
 */
let socket: Socket | null = null;
const connectionListeners = new Set<() => void>();
const notifyConnection = () => connectionListeners.forEach((l) => l());

function vendorSocket(): Socket {
  if (socket) return socket;
  const s = io(SOCKET_NAMESPACE, {
    // dev: Vite proxy, production: Nginx — path /socket.io เดียวกับ API
    transports: ['websocket'],
    // อ่าน token ล่าสุดทุกครั้งที่ต่อใหม่ (access token อายุ 15 นาที)
    auth: (cb) => cb({ token: session.accessToken() }),
  });
  s.on('connect', notifyConnection);
  s.on('disconnect', notifyConnection);
  s.on('connect_error', (error) => {
    notifyConnection();
    // token หมดอายุ: ต่ออายุแล้วต่อใหม่ (server ปฏิเสธใน handshake จะไม่ต่อใหม่เอง)
    if (error.message !== ErrorCode.UNAUTHORIZED) return;
    void refreshAccessToken().then((token) => {
      if (token) s.connect();
    });
  });
  socket = s;
  return s;
}

session.subscribe(() => {
  if (session.get().status !== 'anonymous' || !socket) return;
  socket.disconnect();
  socket = null;
  notifyConnection();
});

function subscribeConnection(listener: () => void) {
  connectionListeners.add(listener);
  return () => {
    connectionListeners.delete(listener);
  };
}

/** socket ต่ออยู่ไหม (false ระหว่างหลุด/กำลังต่อใหม่) — ใช้แสดงแถบ "กำลังเชื่อมต่อใหม่" */
export function useSocketConnected(): boolean {
  return useSyncExternalStore(subscribeConnection, () => socket?.connected ?? false);
}

/**
 * ดูผังวันขายแบบ realtime: `md:join` ทุกครั้งที่ต่อ (รวมต่อใหม่ — ห้องหายเมื่อหลุด) แล้วโหลดผังใหม่
 * `stall:updated` → แก้ cache ของผังทันที; `booking:changed` → โหลดการจองของฉันใหม่
 * กลับมาที่แท็บ / เน็ตกลับมา → โหลดผังใหม่ (§10.3)
 */
export function useMarketDaySocket(marketDayId: string): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const s = vendorSocket();
    const key = marketDayKey(marketDayId);
    const refetch = () => void queryClient.invalidateQueries({ queryKey: key });

    const join = () => {
      void s.emitWithAck(SocketEvent.MD_JOIN, { marketDayId });
      refetch();
    };
    const onStall = (p: StallUpdatedPayload) => {
      if (p.marketDayId !== marketDayId) return;
      let unknownMine = false;
      queryClient.setQueryData<MarketDayStallsData>(key, (old) =>
        old
          ? {
              ...old,
              stalls: old.stalls.map((stall) => {
                if (stall.id !== p.stallId) return stall;
                // ของฉันแต่ยังไม่รู้ id การจอง (จองจากอีกแท็บ/เครื่อง) → โหลดผังใหม่เอา id
                unknownMine = p.mine && !stall.bookingId;
                return {
                  ...stall,
                  status: p.state,
                  mine: p.mine,
                  bookingId: p.mine ? stall.bookingId : null,
                };
              }),
            }
          : old,
      );
      if (unknownMine) refetch();
    };
    const onBooking = () => void queryClient.invalidateQueries({ queryKey: MY_BOOKINGS_KEY });
    const onVisible = () => {
      if (document.visibilityState === 'visible') refetch();
    };

    s.on('connect', join);
    s.on(SocketEvent.STALL_UPDATED, onStall);
    s.on(SocketEvent.BOOKING_CHANGED, onBooking);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', refetch);
    if (s.connected) join();

    return () => {
      if (s.connected) s.emit(SocketEvent.MD_LEAVE, { marketDayId });
      s.off('connect', join);
      s.off(SocketEvent.STALL_UPDATED, onStall);
      s.off(SocketEvent.BOOKING_CHANGED, onBooking);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', refetch);
    };
  }, [marketDayId, queryClient]);
}
