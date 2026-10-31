import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorCode, SOCKET_NAMESPACE, SocketEvent } from '@market-booking/shared';
import { io } from 'socket.io-client';
import { renewAccessToken } from './api-client';
import { session } from './session';

/**
 * Socket.IO ของ admin (Overview §10) — ตอนนี้ใช้กับ badge ผู้ค้ารออนุมัติ (`vendor:registered`)
 * event แค่บอกว่ามีการเปลี่ยนแปลง ข้อมูลจริงโหลดผ่าน REST (invalidate query)
 */
export function useAdminRealtime(enabled: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    // path /socket.io เดียวกับ API (dev: Vite proxy, production: Nginx)
    const socket = io(SOCKET_NAMESPACE, {
      transports: ['websocket'],
      // อ่าน token ล่าสุดทุกครั้งที่ต่อใหม่ (access token อายุ 15 นาที)
      auth: (cb) => cb({ token: session.accessToken() }),
    });
    const refreshVendors = () => void queryClient.invalidateQueries({ queryKey: ['vendors'] });

    socket.on(SocketEvent.VENDOR_REGISTERED, refreshVendors);
    // ต่อใหม่หลังหลุด อาจพลาด event ระหว่างนั้น → โหลดใหม่ (§10.3)
    socket.on('connect', refreshVendors);
    socket.on('connect_error', (error) => {
      // token หมดอายุ: ต่ออายุแล้วต่อใหม่ (server ปฏิเสธใน handshake จะไม่ต่อใหม่เอง)
      if (error.message !== ErrorCode.UNAUTHORIZED) return;
      void renewAccessToken().then((token) => {
        if (token) socket.connect();
      });
    });
    return () => {
      socket.disconnect();
    };
  }, [enabled, queryClient]);
}
