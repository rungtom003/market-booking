import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

export const SWAGGER_PATH = 'api/docs';

/** Swagger UI ที่ `/api/docs` (JSON ที่ `/api/docs-json`) — เปิดเฉพาะเมื่อไม่ใช่ production */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Market Booking API')
    .setDescription(
      [
        'ระบบจองล็อคขายของตลาด',
        '',
        'ทุก response ห่อเป็น `{ data, meta? }` และ error เป็น `{ error: { code, message, details? } }`',
        'ส่ง/รับ header `x-request-id` เพื่ออ้างอิง log',
      ].join('\n'),
    )
    .setVersion('1')
    .addBearerAuth()
    .build();

  // cleanupOpenApiDoc แปลง DTO ที่สร้างจาก Zod (createZodDto) ให้เป็น schema ที่ Swagger อ่านได้
  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
  SwaggerModule.setup(SWAGGER_PATH, app, document);
}
