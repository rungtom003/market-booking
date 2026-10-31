/** Socket.IO namespace สำหรับการจอง (Overview §10.1) */
export const SOCKET_NAMESPACE = '/booking';

/** ชื่อ event ทั้งหมด (Overview §10.2) — ห้ามประกาศ string ซ้ำที่อื่น */
export const SocketEvent = {
  // Client → Server
  MD_JOIN: 'md:join',
  MD_LEAVE: 'md:leave',
  // Server → Client
  STALL_UPDATED: 'stall:updated',
  ROUND_CHANGED: 'round:changed',
  BOOKING_CHANGED: 'booking:changed',
  WAITLIST_OFFER: 'waitlist:offer',
  SERVER_TIME: 'server:time',
  // Server → Admin
  VENDOR_REGISTERED: 'vendor:registered',
  PAYMENT_SUBMITTED: 'payment:submitted',
} as const;

export type SocketEvent = (typeof SocketEvent)[keyof typeof SocketEvent];

export const socketRoom = {
  marketDay: (marketDayId: string) => `md:${marketDayId}`,
  vendor: (vendorId: string) => `vendor:${vendorId}`,
  admin: (marketId: string) => `admin:${marketId}`,
} as const;
