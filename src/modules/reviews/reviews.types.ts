// src/modules/reviews/reviews.types.ts
import { Review } from '@prisma/client';

export interface ReviewWithRelations extends Review {
  customer: { id: string; name: string | null; phone: string };
  buddy: { id: string; name: string } | null;
  order: { id: string; orderNumber: string; serviceType: string };
}

export interface PaginatedReviews {
  data: ReviewWithRelations[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ReviewStats {
  total: number;
  averageRating: number;
  breakdown: { rating: number; count: number }[];
  pendingComments: number;
}