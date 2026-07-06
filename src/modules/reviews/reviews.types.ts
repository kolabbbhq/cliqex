import { Review } from '@prisma/client';

export interface PaginatedReviews {
  data: (Review & {
    order: { orderNumber: string };
    customer: { name: string | null; phone: string };
buddy: { name: string; phone: string | null } | null;
  })[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ReviewSummary {
  averageRating: number;
  totalReviews: number;
  breakdown: { rating: number; count: number }[];
}