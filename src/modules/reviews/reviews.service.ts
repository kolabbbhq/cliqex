import { Injectable, Logger } from '@nestjs/common';
import { Review } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { TenantContext } from '@common/tenant/tenant-context.service';
import { PaginatedReviews, ReviewSummary } from './reviews.types';

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
  ) {}

  async create(input: {
  orderId: string;
  customerId: string;
  buddyId?: string;
  rating: number;
  awaitingComment: boolean;
  businessId?: string;  // ← add this
}): Promise<Review> {
  const businessId = input.businessId ?? this.tenant.get();
  return this.prisma.review.create({
    data: {
      orderId: input.orderId,
      customerId: input.customerId,
      buddyId: input.buddyId,
      rating: input.rating,
      awaitingComment: input.awaitingComment,
      businessId,
    },
  });
}

  // Update rating if a review already exists for this order, else create one.
  // Reopens the comment flow each time (Edge case: customer taps rating twice).
  async upsert(input: {
  orderId: string;
  customerId: string;
  buddyId?: string;
  rating: number;
  businessId?: string;  // ← add this
}): Promise<Review> {
  const existing = await this.prisma.review.findUnique({
    where: { orderId: input.orderId },
  });

  let review: Review;
  if (existing) {
    review = await this.prisma.review.update({
      where: { id: existing.id },
      data: { rating: input.rating, awaitingComment: true },
    });
  } else {
    review = await this.create({
      orderId: input.orderId,
      customerId: input.customerId,
      buddyId: input.buddyId,
      rating: input.rating,
      awaitingComment: true,
      businessId: input.businessId,  // ← forward it
    });
  }

  if (review.buddyId) {
    await this.updateBuddyRating(review.buddyId);
  }

  return review;
}

  // Only return reviews created within the last 24 hours — abandon stale ones.
async findAwaitingComment(customerId: string, businessId: string): Promise<Review | null> {
  return this.prisma.review.findFirst({
    where: {
      customerId,
      businessId,              // ← use passed param not tenant context
      awaitingComment: true,
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: 'desc' },
  });
}

  async saveComment(reviewId: string, comment: string): Promise<Review> {
    const review = await this.prisma.review.update({
      where: { id: reviewId },
      data: { comment, awaitingComment: false },
    });

    if (review.buddyId) {
      await this.updateBuddyRating(review.buddyId);
    }

    return review;
  }

  async closeAwaitingComment(reviewId: string): Promise<void> {
    await this.prisma.review.update({
      where: { id: reviewId },
      data: { awaitingComment: false },
    });
  }

  async findAll(input: {
    page: number;
    limit: number;
    rating?: number;
  }): Promise<PaginatedReviews> {
    const businessId = this.tenant.get();
    const { page, limit, rating } = input;
    const skip = (page - 1) * limit;

    const where = {
      businessId,
      ...(rating !== undefined && { rating }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          order: { select: { orderNumber: true } },
          customer: { select: { name: true, phone: true } },
          buddy: { select: { name: true, phone: true } },
        },
      }),
      this.prisma.review.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getSummary(): Promise<ReviewSummary> {
  const businessId = this.tenant.get();

  const [avgResult, breakdown] = await Promise.all([
    this.prisma.review.aggregate({
      where: { businessId },
      _avg: { rating: true },
      _count: { rating: true },
    }),
    this.prisma.review.groupBy({
      by: ['rating'],
      where: { businessId },
      _count: { _all: true },
      orderBy: { rating: 'desc' },
    }),
  ]);

  return {
    averageRating: avgResult._avg.rating ?? 0,
    totalReviews: avgResult._count.rating,
    breakdown: breakdown.map((b) => ({ rating: b.rating, count: b._count._all })),
  };
}
  async findByOrderId(orderId: string): Promise<Review | null> {
  return this.prisma.review.findUnique({
    where: { orderId },
    include: {
      customer: { select: { name: true, phone: true } },
      buddy: { select: { name: true, phone: true } },
    },
  });
}

  private async updateBuddyRating(buddyId: string): Promise<void> {
    const result = await this.prisma.review.aggregate({
      where: { buddyId },
      _avg: { rating: true },
      _count: { rating: true },
    });

    await this.prisma.buddy.update({
      where: { id: buddyId },
      data: { rating: result._avg.rating ?? 0 },
    });

    this.logger.log(`Buddy ${buddyId} rating recalculated: ${result._avg.rating ?? 0}`);
  }
}
