import { BuddyStatus } from '@prisma/client';
export interface BuddyView {
  id: string;
  name: string;
  phone: string | null;  // ← was string
  serviceTypes: string[];
  status: BuddyStatus;
  isActive: boolean;
  rating: number;
  totalDeliveries: number;
  createdAt: Date;
  currentOrder?: {
    id: string;
    orderNumber: string;
    status: string;
    customer: {
      name: string | null;
      phone: string;
    };
  } | null;
}

export interface PaginatedBuddies {
  data: BuddyView[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
