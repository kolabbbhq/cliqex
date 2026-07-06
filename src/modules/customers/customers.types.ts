import { Customer } from '@prisma/client';


export interface SafeCustomer {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  address: string | null;
  totalOrders: number;
  totalSpend: number;
  isBlocked: boolean;
  createdAt: Date;
  updatedAt: Date;
}


export interface CustomerWithStats extends SafeCustomer {
  recentOrders: {
    id: string;
    orderNumber: string;
    status: string;
    total: number;
    createdAt: Date;
  }[];
}


export interface PaginatedCustomers {
  data: SafeCustomer[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}


export interface FindOrCreateResult {
  customer: Customer;
  isNew: boolean;
}
