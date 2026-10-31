import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { ActorType, REQUEST_ID_HEADER } from '@market-booking/shared';
import type { NextFunction, Request, Response } from 'express';

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
  /** ตั้งโดย JwtAuthGuard เมื่อ request มี access token ที่ถูกต้อง */
  actor?: { type: ActorType; id: string };
}

// AsyncLocalStorage ทำให้ service (เช่น AuditService) อ่าน ip/user-agent ของ request ปัจจุบันได้
// โดยไม่ต้องส่ง Request ผ่านทุกชั้น
const storage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function setRequestActor(actor: NonNullable<RequestContext['actor']>): void {
  const store = storage.getStore();
  if (store) store.actor = actor;
}

/** รัน fn ใน context ที่กำหนด — ใช้กับ worker/job ที่ไม่ได้มาจาก HTTP และใน test */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

// รับ request id จาก client/proxy ได้ถ้ารูปแบบปลอดภัย (กัน log injection) ไม่งั้นสร้างใหม่
const SAFE_REQUEST_ID = /^[\w-]{1,64}$/;

/**
 * Express middleware — ต้องอยู่ก่อน pino-http (setup-app.ts) เพื่อให้ log ใช้ request id เดียวกัน
 * ส่ง request id กลับใน header `x-request-id` ทุก response
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const requestId =
    typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();

  req.id = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);

  storage.run({ requestId, ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 500) }, next);
}
