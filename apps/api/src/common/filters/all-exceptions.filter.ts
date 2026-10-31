import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { toErrorResponse } from './to-error-response';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    // WebSocket (Phase 4.3) จัดการ error เอง
    if (host.getType() !== 'http') throw exception;

    const { status, body, unexpected } = toErrorResponse(exception);
    if (unexpected) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    host.switchToHttp().getResponse<Response>().status(status).json(body);
  }
}
