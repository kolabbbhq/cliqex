import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { TenantContext } from '@common/tenant/tenant-context.service';
import { Message, MessageDirection, MessageType, MessageStatus } from '@prisma/client';

export interface SaveMessageInput {
  waMessageId:    string;
  customerId:     string;
  orderId?:       string;
  direction:      MessageDirection;
  type:           MessageType;
  content?:       string;
  mediaUrl?:      string;
  buttonPayload?: string;
}

@Injectable()
export class WhatsappRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
  ) {}

  async saveMessage(input: SaveMessageInput): Promise<Message> {
    return this.prisma.message.create({
      data: { ...input, businessId: this.tenant.get() },   // ✅
    });
  }

  async updateMessageStatus(waMessageId: string, status: MessageStatus): Promise<void> {
    await this.prisma.message.updateMany({
      where: { waMessageId },
      data:  { status },
    });
  }

  async messageExists(waMessageId: string): Promise<boolean> {
    const count = await this.prisma.message.count({ where: { waMessageId } });
    return count > 0;
  }

  async getOrderThread(orderId: string): Promise<Message[]> {
    return this.prisma.message.findMany({
      where:   { orderId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getCustomerThread(customerId: string): Promise<Message[]> {
    return this.prisma.message.findMany({
      where:   { customerId },
      orderBy: { createdAt: 'asc' },
      take:    100,
    });
  }
async getThreadByCustomer(customerId: string, limit = 200) {
  const businessId = this.tenant.get();

  return this.prisma.message.findMany({
    where: { customerId, businessId },
    orderBy: { createdAt: 'desc' }, // newest first, then reverse in service/frontend for display
    take: limit,
    include: {
      order: { select: { id: true, orderNumber: true, status: true } },
    },
  });
}
}