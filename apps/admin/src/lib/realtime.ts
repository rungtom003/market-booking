import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorCode, SOCKET_NAMESPACE, SocketEvent } from '@market-booking/shared';
import type { CheckinUpdatedPayload, StallUpdatedPayload } from '@market-booking/shared';
import { type Socket, io } from 'socket.io-client';
import { renewAccessToken } from './api-client';
import { session } from './session';

/**
 * socket เดียวของแอป admin (Overview §10) — ต่อเมื่อมีหน้าที่ใช้ครั้งแรก, ปิดเมื่อ logout
 * event แค่บอกว่ามีการเปลี่ยนแปลง ข้อมูลจริงโหลดผ่าน REST (invalidate query)
 */
let socket: Socket | null = null;

function adminSocket(): Socket {
  if (socket) return socket;
  // path /socket.io เดียวกับ API (dev: Vite proxy, production: Nginx)
  const s = io(SOCKET_NAMESPACE, {
    transports: ['websocket'],
    // อ่าน token ล่าสุดทุกครั้งที่ต่อใหม่ (access token อายุ 15 นาที)
    auth: (cb) => cb({ token: session.accessToken() }),
  });
  s.on('connect_error', (error) => {
    // token หมดอายุ: ต่ออายุแล้วต่อใหม่ (server ปฏิเสธใน handshake จะไม่ต่อใหม่เอง)
    if (error.message !== ErrorCode.UNAUTHORIZED) return;
    void renewAccessToken().then((token) => {
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
});

/**
 * badge ของเมนู — ผู้ค้ารออนุมัติ (`vendor:registered`) และสลิปรอตรวจ (`payment:submitted`)
 * โหลดใหม่เมื่อได้ event และทุกครั้งที่ต่อ (อาจพลาด event ระหว่างหลุด); เปิดเฉพาะส่วนที่มีสิทธิ์
 */
export function useAdminRealtime({
  vendors,
  payments,
}: {
  vendors: boolean;
  payments: boolean;
}): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!vendors && !payments) return;
    const s = adminSocket();
    const refreshVendors = () => void queryClient.invalidateQueries({ queryKey: ['vendors'] });
    const refreshPayments = () => void queryClient.invalidateQueries({ queryKey: ['payments'] });
    const resync = () => {
      if (vendors) refreshVendors();
      if (payments) refreshPayments();
    };
    if (vendors) s.on(SocketEvent.VENDOR_REGISTERED, refreshVendors);
    if (payments) s.on(SocketEvent.PAYMENT_SUBMITTED, refreshPayments);
    s.on('connect', resync);
    return () => {
      s.off(SocketEvent.VENDOR_REGISTERED, refreshVendors);
      s.off(SocketEvent.PAYMENT_SUBMITTED, refreshPayments);
      s.off('connect', resync);
    };
  }, [vendors, payments, queryClient]);
}

/**
 * ผังวันขายฝั่ง admin แบบ realtime: `md:join` ทุกครั้งที่ต่อ แล้วโหลดผัง/ตารางใหม่เมื่อล็อคในวันนั้นเปลี่ยน
 * (ฝั่ง admin ต้องการชื่อผู้ค้าซึ่งไม่อยู่ใน event สาธารณะ จึงโหลดผ่าน REST เสมอ)
 */
export function useAdminMarketDaySocket(marketDayId: string | null): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!marketDayId) return;
    const s = adminSocket();
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-day', marketDayId] });
      void queryClient.invalidateQueries({ queryKey: ['admin-bookings'] });
      // ล็อคเปลี่ยน = คิวรออาจได้สิทธิ์/หมดเวลา
      void queryClient.invalidateQueries({ queryKey: ['admin-waitlists', marketDayId] });
    };
    const join = () => {
      void s.emitWithAck(SocketEvent.MD_JOIN, { marketDayId });
      refresh();
    };
    const onStall = (p: StallUpdatedPayload | CheckinUpdatedPayload) => {
      if (p.marketDayId === marketDayId) refresh();
    };
    s.on('connect', join);
    s.on(SocketEvent.STALL_UPDATED, onStall);
    // check-in ส่งห้อง admin ของตลาด (ไม่ใช่ห้องวันขาย)
    s.on(SocketEvent.CHECKIN_UPDATED, onStall);
    if (s.connected) join();
    return () => {
      if (s.connected) s.emit(SocketEvent.MD_LEAVE, { marketDayId });
      s.off('connect', join);
      s.off(SocketEvent.STALL_UPDATED, onStall);
      s.off(SocketEvent.CHECKIN_UPDATED, onStall);
    };
  }, [marketDayId, queryClient]);
}

/**
 * หน้า check-in: เจ้าหน้าที่หลายคนสแกนพร้อมกัน → โหลดรายการใหม่เมื่อมี `checkin:updated` ของวันนั้น
 * (ต่อใหม่หลังหลุด = โหลดใหม่ เผื่อพลาด event)
 */
export function useCheckinSocket(marketDayId: string | null, date: string): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!marketDayId) return;
    const s = adminSocket();
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin-checkin', date] });
    const onCheckin = (p: CheckinUpdatedPayload) => {
      if (p.marketDayId === marketDayId) refresh();
    };
    s.on(SocketEvent.CHECKIN_UPDATED, onCheckin);
    s.on('connect', refresh);
    return () => {
      s.off(SocketEvent.CHECKIN_UPDATED, onCheckin);
      s.off('connect', refresh);
    };
  }, [marketDayId, date, queryClient]);
}
