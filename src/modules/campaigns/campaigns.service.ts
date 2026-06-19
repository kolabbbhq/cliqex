import {
  ListCampaignsInput,
  CreateCampaignInput,
} from '@modules/campaigns/schemas/campaigns.schema';
import { Campaign, CampaignAudience } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { WhatsappService } from '@modules/whatsapp/whatsapp.service';
import { TenantContext } from '@common/tenant/tenant-context.service';
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';

const ACTIVE_DAYS = 30;
const INACTIVE_DAYS = 60;
const VIP_MIN_ORDERS = 5;

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly whatsappService: WhatsappService,
  ) {}

  async create(data: CreateCampaignInput, adminId: string): Promise<Campaign> {
    return this.prisma.campaign.create({
      data: {
        businessId: this.tenantContext.get(),
        name: data.name,
        templateName: data.templateName,
        templateVars: data.templateVars,
        audience: data.audience as CampaignAudience,
        scheduledAt: data.scheduledAt,
        createdBy: adminId,
      },
    });
  }

  async findAll(input: ListCampaignsInput) {
    const { page, limit } = input;
    const skip = (page - 1) * limit;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.campaign.findMany({
        where: { businessId: this.tenantContext.get() },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.campaign.count({
        where: { businessId: this.tenantContext.get() },
      }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async previewAudience(audience: CampaignAudience): Promise<{ count: number }> {
    const phones = await this.resolveAudience(audience);
    return { count: phones.length };
  }

  async send(campaignId: string): Promise<{ sent: number }> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) throw new NotFoundException(`Campaign ${campaignId} not found`);

    if (campaign.status === 'SENDING' || campaign.status === 'DONE') {
      throw new BadRequestException(`Campaign is already ${campaign.status.toLowerCase()}`);
    }

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'SENDING' },
    });

    const phones = await this.resolveAudience(campaign.audience);
    let sentCount = 0;

    this.logger.log(`Campaign ${campaign.name} — sending to ${phones.length} customers`);

    for (const phone of phones) {
      try {
        await this.whatsappService.sendText({
          to: phone,
          message: campaign.templateName, // placeholder — use template API in production
        });

        sentCount++;

        await this.delay(100);
      } catch (err) {
        this.logger.error(`Campaign send failed for ${phone}: ${err}`);
      }
    }

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'DONE', sentCount, sentAt: new Date() },
    });

    this.logger.log(`Campaign ${campaign.name} done — sent to ${sentCount}/${phones.length}`);

    return { sent: sentCount };
  }

  private async resolveAudience(audience: CampaignAudience): Promise<string[]> {
    const now = new Date();
    const activeCutoff = new Date(now.getTime() - ACTIVE_DAYS * 86400000);
    const inactiveCutoff = new Date(now.getTime() - INACTIVE_DAYS * 86400000);

    const where: any = { isBlocked: false };

    if (audience === 'ACTIVE') {
      where.orders = {
        some: { createdAt: { gte: activeCutoff }, status: 'DELIVERED' },
      };
    } else if (audience === 'INACTIVE') {
      where.orders = {
        none: { createdAt: { gte: inactiveCutoff } },
      };
      where.totalOrders = { gt: 0 };
    } else if (audience === 'VIP') {
      where.totalOrders = { gte: VIP_MIN_ORDERS };
    }

    const customers = await this.prisma.customer.findMany({
      where,
      select: { phone: true },
    });

    return customers.map((c) => c.phone);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
