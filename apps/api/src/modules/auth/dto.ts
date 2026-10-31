import { adminLoginSchema, sessionActorSchema } from '@market-booking/shared';
import { createZodDto } from 'nestjs-zod';

export class AdminLoginDto extends createZodDto(adminLoginSchema) {}
export class SessionActorDto extends createZodDto(sessionActorSchema) {}
