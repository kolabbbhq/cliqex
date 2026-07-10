// src/modules/reviews/reviews.module.ts
import { Module } from '@nestjs/common';
import { ReviewsController } from '@modules/reviews/reviews.controller';
import { ReviewsService } from '@modules/reviews/reviews.service';
import { ReviewsRepository } from '@modules/reviews/reviews.repository';

@Module({
  controllers: [ReviewsController],
  providers: [ReviewsService, ReviewsRepository],
  exports: [ReviewsService],
})
export class ReviewsModule {}