// src/modules/reviews/reviews.repository.ts
import { Injectable } from '@nestjs/common';
import { Prisma, Review } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { TenantContext } from '@common/tenant/tenant-context.service';
import {
  ListReviewsInput,
} from '@modules/reviews/schemas/reviews.schema';
import {
  PaginatedReviews,
  ReviewWithRelations,
  ReviewStats,
} from '@modules/reviews/reviews.types';

export interface UpsertReviewInput {
  orderId: string;
  customerId: string;
  buddyId?: string;
  rating: number;
  businessId: string;
}

@Injectable()
export class ReviewsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
  ) {}

  private readonly include = {
    customer: { select: { id: true, name: true, phone: true } },
    buddy: { select: { id: true, name: true } },
    order: { select: { id: true, orderNumber: true, serviceType: true } },
  } satisfies Prisma.ReviewInclude;

  // ── Admin-facing list ──────────────────────────────────────────
  async findAllForBusiness(input: ListReviewsInput): Promise<PaginatedReviews> {
    const businessId = this.tenant.get();
    const { page, limit, rating, buddyId, hasComment, awaitingComment, fromDate, toDate } = input;
    const skip = (page - 1) * limit;

    const where: Prisma.ReviewWhereInput = {
      businessId,
      ...(rating !== undefined && { rating }),
      ...(buddyId && { buddyId }),
      ...(hasComment !== undefined && {
        comment: hasComment ? { not: null } : null,
      }),
      ...(awaitingComment !== undefined && { awaitingComment }),
      ...((fromDate || toDate) && {
        createdAt: {
          ...(fromDate && { gte: fromDate }),
          ...(toDate && { lte: toDate }),
        },
      }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: this.include,
      }),
      this.prisma.review.count({ where }),
    ]);

    return {
      data: data as ReviewWithRelations[],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOneForBusiness(id: string): Promise<ReviewWithRelations | null> {
    const businessId = this.tenant.get();
    return this.prisma.review.findFirst({
      where: { id, businessId },
      include: this.include,
    }) as Promise<ReviewWithRelations | null>;
  }

 async getStats(buddyId?: string): Promise<ReviewStats> {
  const businessId = this.tenant.get();
  const where: Prisma.ReviewWhereInput = { businessId, ...(buddyId && { buddyId }) };

  const grouped = await this.prisma.review.groupBy({
    by: ['rating'],
    where,
    _count: { rating: true },
    orderBy: { rating: 'asc' },
  });

  const [total, aggregate, pendingComments] = await this.prisma.$transaction([
    this.prisma.review.count({ where }),
    this.prisma.review.aggregate({ where, _avg: { rating: true } }),
    this.prisma.review.count({ where: { ...where, awaitingComment: true } }),
  ]);

  const breakdown = [5, 4, 3, 2, 1].map((r) => ({
    rating: r,
    count: grouped.find((g) => g.rating === r)?._count.rating ?? 0,
  }));

  return {
    total,
    averageRating: aggregate._avg.rating ? Number(aggregate._avg.rating.toFixed(2)) : 0,
    breakdown,
    pendingComments,
  };
}


  // ── Customer-facing (used by WhatsappService) ──────────────────
  async findAwaitingComment(customerId: string, businessId: string): Promise<Review | null> {
    return this.prisma.review.findFirst({
      where: { customerId, businessId, awaitingComment: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async upsert(input: UpsertReviewInput): Promise<Review> {
    return this.prisma.review.upsert({
      where: { orderId: input.orderId },
      create: {
        orderId: input.orderId,
        customerId: input.customerId,
        buddyId: input.buddyId,
        businessId: input.businessId,
        rating: input.rating,
        awaitingComment: true,
      },
      update: {
        rating: input.rating,
        buddyId: input.buddyId,
        awaitingComment: true,
      },
    });
  }

  async saveComment(id: string, comment: string): Promise<Review> {
    return this.prisma.review.update({
      where: { id },
      data: { comment, awaitingComment: false },
    });
  }

  async closeAwaitingComment(id: string): Promise<Review> {
    return this.prisma.review.update({
      where: { id },
      data: { awaitingComment: false },
    });
  }

  async findByOrderId(orderId: string): Promise<ReviewWithRelations | null> {
  const businessId = this.tenant.get();
  return this.prisma.review.findFirst({
    where: { orderId, businessId },
    include: this.include,
  }) as Promise<ReviewWithRelations | null>;
}
}