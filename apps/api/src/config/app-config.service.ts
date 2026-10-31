import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from './env.schema';

/** อ่าน env แบบ type-safe (ค่าผ่าน validate แล้วตอน boot) */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }

  get corsOrigins(): string[] {
    return [this.get('WEB_ORIGIN'), this.get('ADMIN_ORIGIN')];
  }
}
