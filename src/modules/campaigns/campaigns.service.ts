import {
  ListCampaignsInput,
  CreateCampaignInput,
} from '@modules/campaigns/schemas/campaigns.schema';
import { Campaign, CampaignAudience } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { WhatsappService } from '@modules/whatsapp/whatsapp.service';
import { BusinessService } from '@modules/business/business.service';
import { TenantContext } from '@common/tenant/tenant-context.service';
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { TemplateComponent } from '@modules/whatsapp/whatsapp.types';

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
    private readonly businessService: BusinessService,   // ← ADD to constructor + module
  ) {}

  async create(data: CreateCampaignInput, adminId: string): Promise<Campaign> {
    return this.prisma.campaign.create({
      data: {
        businessId: this.tenantContext.get(),
        name: data.name,
        templateName: data.templateName,
        templateVars: data.templateVars,
        languageCode: data.languageCode ?? 'en',         // ← NEW
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
    const businessId = this.tenantContext.get();
    const phones = await this.resolveAudience(audience, businessId);
    return { count: phones.length };
  }

async send(campaignId: string): Promise<{ sent: number; recipients: number }> {
  const campaign = await this.prisma.campaign.findFirst({
    where: { id: campaignId, businessId: this.tenantContext.get() },
  });

  if (!campaign) throw new NotFoundException(`Campaign ${campaignId} not found`);

  if (campaign.status === 'SENDING' || campaign.status === 'DONE') {
    throw new BadRequestException(`Campaign is already ${campaign.status.toLowerCase()}`);
  }

  // ✅ Load the business that owns this campaign — get its WhatsApp credentials
  const business = await this.businessService.getById(campaign.businessId);

  if (!business.whatsappToken || !business.whatsappPhoneId) {
    throw new BadRequestException(
      `Business ${campaign.businessId} has no WhatsApp credentials configured`,
    );
  }

  // ✅ Resolve audience BEFORE flipping status — now returns full customer
  // objects (id, phone, name) instead of just phone strings, so we can
  // personalize {{1}} per-recipient instead of reusing one static value.
  const customers = await this.resolveAudience(campaign.audience, campaign.businessId);

  if (customers.length === 0) {
    throw new BadRequestException(
      `No customers match audience "${campaign.audience}" for this business — nothing to send. ` +
      `Check /campaigns/audience-preview?audience=${campaign.audience} before sending.`,
    );
  }

  await this.prisma.campaign.update({
    where: { id: campaignId },
    data: { status: 'SENDING' },
  });

  let sentCount = 0;

  this.logger.log(
    `Campaign "${campaign.name}" — sending to ${customers.length} customers for business ${campaign.businessId}`,
  );

  const baseVars = (campaign.templateVars as Record<string, string> | null) ?? {};

  for (const customer of customers) {
    try {
      // ✅ Build components PER CUSTOMER — {{1}} is overridden with this
      // customer's real name (falling back to "there" if none on file).
      // Any other vars (e.g. {{2}} for a discount) come from the campaign
      // and stay the same for everyone.
      const vars = {
        ...baseVars,
        '1': customer.name?.trim() || 'there',
      };
      const components = this.buildTemplateComponents(vars);

      await this.whatsappService.sendTemplate({
        to: customer.phone,
        templateName: campaign.templateName,
        languageCode: campaign.languageCode ?? 'en',
        components,
        token: business.whatsappToken,
        phoneId: business.whatsappPhoneId,
      });

      sentCount++;
    } catch (err: any) {
      // Log and continue — one failure must not abort the whole campaign
      this.logger.error(
        `Campaign "${campaign.name}" send failed for ${customer.phone}: ${err.response?.data ? JSON.stringify(err.response.data) : err.message}`,
      );
    }

    await this.delay(100);
  }

  // ✅ Now FAILED only means "we had real recipients and every single send
  // attempt to Meta failed" — not "nobody matched the audience filter."
  await this.prisma.campaign.update({
    where: { id: campaignId },
    data: { status: sentCount > 0 ? 'DONE' : 'FAILED', sentCount, sentAt: new Date() },
  });

  this.logger.log(
    `Campaign "${campaign.name}" complete — sent: ${sentCount}/${customers.length}`,
  );

  return { sent: sentCount, recipients: customers.length };
}

  // ----------------------------------------------------------------
  // buildTemplateComponents
  //
  // Converts templateVars to Meta components format.
  //
  // templateVars: { "1": "John", "2": "3" }
  // → body component with parameters [{ type: "text", text: "John" }, ...]
  //
  // If templateVars is null/empty, returns undefined (no components sent).
  // ----------------------------------------------------------------
  private buildTemplateComponents(
    templateVars: Record<string, string> | null,
  ): TemplateComponent[] | undefined {
    if (!templateVars || Object.keys(templateVars).length === 0) return undefined;

    const parameters = Object.entries(templateVars)
      .sort(([a], [b]) => Number(a) - Number(b))   // sort by key: "1", "2", "3"...
      .map(([, value]) => ({ type: 'text' as const, text: value }));

    return [{ type: 'body', parameters }];
  }

  // ----------------------------------------------------------------
  // resolveAudience — NOW BUSINESS-SCOPED
  // ----------------------------------------------------------------
  private async resolveAudience(
  audience: CampaignAudience,
  businessId: string,
): Promise<{ phone: string; name: string | null }[]> {
  const now = new Date();
  const activeCutoff = new Date(now.getTime() - ACTIVE_DAYS * 86400000);
  const inactiveCutoff = new Date(now.getTime() - INACTIVE_DAYS * 86400000);

  const where: any = {
    businessId,
    isBlocked: false,
  };

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
    select: { phone: true, name: true },
  });

  return customers;
}

  // private delay(ms: number): Promise<void> {
  //   return new Promise((resolve) => setTimeout(resolve, ms));
  // }
  private delay
}
