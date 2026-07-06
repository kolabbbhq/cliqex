import { Module } from '@nestjs/common';
import { PrismaModule } from '@common/prisma/prisma.module';
import { ReviewsService } from './reviews.service';
import { ReviewsController } from './reviews.controller';

@Module({
  imports: [PrismaModule],
  providers: [ReviewsService],
  controllers: [ReviewsController],
  exports: [ReviewsService],
})
export class ReviewsModule {}
