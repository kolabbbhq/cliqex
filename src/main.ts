import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { NestFactory } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });
  app.useGlobalPipes(new ZodValidationPipe());

 app.enableCors({
  origin: [/\.cliqex\.online$/, 'https://cliqex.online'],
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  credentials: true,
});

  app.setGlobalPrefix('api/v1');

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`ErrandsBuddy API running on port ${port}`);
}

bootstrap();
