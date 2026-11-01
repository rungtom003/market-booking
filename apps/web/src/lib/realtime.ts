import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorCode, SOCKET_NAMESPACE, SocketEvent } from '@market-booking/shared';
import type {
  CheckinUpdatedPayload,
  BookingChangedPayload,
  StallUpdatedPayload,
  WaitlistOfferPayload,
} from '@market-booking/shared';
import { type Socket, io } from 'socket.io-client';
import { MY_BOOKINGS_KEY } from '../api/booking';
import { checkinQrKey } from '../api/checkin';
import { type MarketDayStallsData, marketDayKey } from '../api/market';
import { paymentKey } from '../api/payment';
import { WAITLIST_KEY } from '../api/waitlist';
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
    const onBooking = (p: BookingChangedPayload) => {
      void queryClient.invalidateQueries({ queryKey: MY_BOOKINGS_KEY });
      void queryClient.invalidateQueries({ queryKey: paymentKey(p.bookingId) });
      // HOLD จากคิวรอ ยืนยัน/หมดเวลา = สถานะคิวเปลี่ยน
      void queryClient.invalidateQueries({ queryKey: WAITLIST_KEY });
    };
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

/**
 * การจองของฉันเปลี่ยน (เช่น เจ้าหน้าที่อนุมัติ/ไม่ผ่านสลิป, หมดเวลาชำระ, check-in แล้ว) → โหลดการจอง/การชำระ/QR ใหม่
 * ใช้ในหน้าที่ไม่ได้ดูผัง (หน้าชำระเงิน, การจองของฉัน); ต่อใหม่หลังหลุด = โหลดใหม่ทั้งหมด
 */
export function useMyBookingUpdates(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const s = vendorSocket();
    const onBooking = (p: BookingChangedPayload) => {
      void queryClient.invalidateQueries({ queryKey: MY_BOOKINGS_KEY });
      void queryClient.invalidateQueries({ queryKey: paymentKey(p.bookingId) });
      // HOLD จากคิวรอ ยืนยัน/หมดเวลา = สถานะคิวเปลี่ยน
      void queryClient.invalidateQueries({ queryKey: WAITLIST_KEY });
    };
    const onCheckin = (p: CheckinUpdatedPayload) => {
      void queryClient.invalidateQueries({ queryKey: MY_BOOKINGS_KEY });
      void queryClient.invalidateQueries({ queryKey: checkinQrKey(p.bookingId) });
    };
    const resync = () => {
      void queryClient.invalidateQueries({ queryKey: MY_BOOKINGS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['payment'] });
      void queryClient.invalidateQueries({ queryKey: WAITLIST_KEY });
      void queryClient.invalidateQueries({ queryKey: ['checkin-qr'] });
    };
    s.on(SocketEvent.BOOKING_CHANGED, onBooking);
    s.on(SocketEvent.CHECKIN_UPDATED, onCheckin);
    s.on('connect', resync);
    return () => {
      s.off(SocketEvent.BOOKING_CHANGED, onBooking);
      s.off(SocketEvent.CHECKIN_UPDATED, onCheckin);
      s.off('connect', resync);
    };
  }, [queryClient]);
}

/**
 * ได้สิทธิ์ล็อคจากคิวรอ (`waitlist:offer`) — HOLD ในชื่อผู้ค้าถูกสร้างแล้ว (มาพร้อม `booking:changed`)
 * หน้าใช้แสดงข้อความแจ้งทันที; callback ควรคงที่ (useCallback)
 */
export function useWaitlistOffer(onOffer: (offer: WaitlistOfferPayload) => void): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const s = vendorSocket();
    const handler = (p: WaitlistOfferPayload) => {
      void queryClient.invalidateQueries({ queryKey: WAITLIST_KEY });
      void queryClient.invalidateQueries({ queryKey: MY_BOOKINGS_KEY });
      onOffer(p);
    };
    s.on(SocketEvent.WAITLIST_OFFER, handler);
    return () => {
      s.off(SocketEvent.WAITLIST_OFFER, handler);
    };
  }, [queryClient, onOffer]);
}
