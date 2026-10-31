import type { ActorType } from '@market-booking/shared';
import type { CookieOptions, Request, Response } from 'express';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH, REFRESH_TOKEN_TTL_SECONDS } from './auth.constants';

type SessionActorType = keyof typeof REFRESH_COOKIE;

function options(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure,
    // web/admin เรียก API ผ่าน origin เดียวกัน (Vite proxy / Nginx) — Strict กัน CSRF ได้โดยไม่ต้องมี token เพิ่ม
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  };
}

export function setRefreshCookie(
  res: Response,
  actorType: SessionActorType,
  token: string,
  secure: boolean,
): void {
  res.cookie(REFRESH_COOKIE[actorType], token, {
    ...options(secure),
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  });
}

export function clearRefreshCookie(
  res: Response,
  actorType: SessionActorType,
  secure: boolean,
): void {
  res.clearCookie(REFRESH_COOKIE[actorType], options(secure));
}

export function readRefreshCookie(req: Request, actorType: Extract<ActorType, SessionActorType>) {
  const value: unknown = req.cookies?.[REFRESH_COOKIE[actorType]];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
