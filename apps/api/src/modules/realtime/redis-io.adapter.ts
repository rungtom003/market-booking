import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

/**
 * Socket.IO ผ่าน Redis pub/sub — event ที่ instance หนึ่งส่ง ไปถึง socket ที่ต่ออยู่กับ instance อื่น
 * (Overview §5 ข้อ 5: API หลาย instance หลัง Nginx) และตั้ง CORS ตาม env เหมือน REST
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly clients: Redis[] = [];

  constructor(
    app: INestApplicationContext,
    private readonly redisUrl: string,
    private readonly origins: string[],
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: this.origins, credentials: true },
    }) as Server;
    const pub = new Redis(this.redisUrl);
    const sub = pub.duplicate();
    this.clients.push(pub, sub);
    server.adapter(createAdapter(pub, sub));
    return server;
  }

  override async close(server: Server): Promise<void> {
    await super.close(server);
    await Promise.all(this.clients.splice(0).map((c) => c.quit().catch(() => c.disconnect())));
  }
}
