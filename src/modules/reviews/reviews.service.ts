// src/modules/reviews/reviews.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Review } from '@prisma/client';
import { ReviewsRepository, UpsertReviewInput } from '@modules/reviews/reviews.repository';
import { ListReviewsInput } from '@modules/reviews/schemas/reviews.schema';
import {
  PaginatedReviews,
  ReviewStats,
  ReviewWithRelations,
} from '@modules/reviews/reviews.types';

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(private readonly reviewsRepository: ReviewsRepository) {}

  // ── Admin-facing ────────────────────────────────────────────────
  async findAll(input: ListReviewsInput): Promise<PaginatedReviews> {
    return this.reviewsRepository.findAllForBusiness(input);
  }

  async findOne(id: string): Promise<ReviewWithRelations> {
    const review = await this.reviewsRepository.findOneForBusiness(id);
    if (!review) {
      throw new NotFoundException(`Review ${id} not found`);
    }
    return review;
  }

  async getStats(buddyId?: string): Promise<ReviewStats> {
    return this.reviewsRepository.getStats(buddyId);
  }

  // ── Customer-facing (called from WhatsappService) ───────────────
  async findAwaitingComment(customerId: string, businessId: string): Promise<Review | null> {
    return this.reviewsRepository.findAwaitingComment(customerId, businessId);
  }

  async upsert(input: UpsertReviewInput): Promise<Review> {
    const review = await this.reviewsRepository.upsert(input);
    this.logger.log(`Review upserted for order ${input.orderId}: rating=${input.rating}`);
    return review;
  }

  async saveComment(id: string, comment: string): Promise<Review> {
    return this.reviewsRepository.saveComment(id, comment);
  }

  async closeAwaitingComment(id: string): Promise<Review> {
    return this.reviewsRepository.closeAwaitingComment(id);
  }
  async findByOrderId(orderId: string): Promise<ReviewWithRelations | null> {
  return this.reviewsRepository.findByOrderId(orderId);
}
}