import { Injectable } from '@nestjs/common';
import {
  CreateBuddyInput,
  UpdateBuddyInput,
  ListBuddiesInput,
} from '@modules/buddies/schemas/buddies.schema';
import { Buddy, BuddyStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { PaginatedBuddies } from '@modules/buddies/buddies.types';
import { TenantContext } from '@common/tenant/tenant-context.service';

@Injectable()
export class BuddiesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
  ) {}

  async create(data: CreateBuddyInput): Promise<Buddy> {
    return this.prisma.buddy.create({
      data: { ...data, businessId: this.tenant.get() },
    });
  }

  async findById(id: string): Promise<Buddy | null> {
    return this.prisma.buddy.findFirst({
      where: { id, businessId: this.tenant.get() },
    });
  }

  async findByPhone(phone: string): Promise<Buddy | null> {
  if (!phone) return null;
  const businessId = this.tenant.get();
  return this.prisma.buddy.findUnique({
    where: { businessId_phone: { businessId, phone } },
  });
}
  async findAvailable(serviceType?: string): Promise<Buddy[]> {
    return this.prisma.buddy.findMany({
      where: {
        businessId: this.tenant.get(),
        status: BuddyStatus.AVAILABLE,
        isActive: true,
        ...(serviceType && {
          serviceTypes: { has: serviceType as any },
        }),
      },
    });
  }

  async update(id: string, data: UpdateBuddyInput): Promise<Buddy> {
    return this.prisma.buddy.update({ where: { id }, data });
  }

  async updateStatus(id: string, status: BuddyStatus): Promise<Buddy> {
    return this.prisma.buddy.update({ where: { id }, data: { status } });
  }

  async recordDelivery(buddyId: string): Promise<void> {
    await this.prisma.buddy.update({
      where: { id: buddyId },
      data: {
        status: BuddyStatus.AVAILABLE,
        totalDeliveries: { increment: 1 },
      },
    });
  }

  async findAll(input: ListBuddiesInput): Promise<PaginatedBuddies> {
    const businessId = this.tenant.get();
    const { page, limit } = input;
    const skip = (page - 1) * limit;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.buddy.findMany({
        where: { businessId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.buddy.count({ where: { businessId } }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
