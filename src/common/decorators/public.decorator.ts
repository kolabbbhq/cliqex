import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Usage: @Public() on any route to skip JWT authentication
// Used on: POST /auth/login, POST /auth/refresh, WhatsApp webhook
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
