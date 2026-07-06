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

  async send(campaignId: string): Promise<{ sent: number }> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
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

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'SENDING' },
    });

    // ✅ Business-scoped audience — only this business's customers
    const phones = await this.resolveAudience(campaign.audience, campaign.businessId);
    let sentCount = 0;

    this.logger.log(
      `Campaign "${campaign.name}" — sending to ${phones.length} customers for business ${campaign.businessId}`,
    );

    // ✅ Build template components from templateVars if provided
    // templateVars shape: { "1": "John", "2": "3" }
    // Each key maps to a positional body variable {{1}}, {{2}}, etc.
    const components = this.buildTemplateComponents(campaign.templateVars as Record<string, string> | null);

    for (const phone of phones) {
      try {
        await this.whatsappService.sendTemplate({
          to: phone,
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
          `Campaign "${campaign.name}" send failed for ${phone}: ${err.response?.data ? JSON.stringify(err.response.data) : err.message}`,
        );
      }

      await this.delay(100);
    }

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: sentCount > 0 ? 'DONE' : 'FAILED', sentCount, sentAt: new Date() },
    });

    this.logger.log(
      `Campaign "${campaign.name}" complete — sent: ${sentCount}/${phones.length}`,
    );

    return { sent: sentCount };
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
    businessId: string,             // ← was missing before
  ): Promise<string[]> {
    const now = new Date();
    const activeCutoff = new Date(now.getTime() - ACTIVE_DAYS * 86400000);
    const inactiveCutoff = new Date(now.getTime() - INACTIVE_DAYS * 86400000);

    // ✅ Always scope to this business's customers
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
      select: { phone: true },
    });

    return customers.map((c) => c.phone);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
