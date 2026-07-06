import axios from 'axios';
import {
  Body,
  Controller,
  Get,
  NotFoundException,
  BadRequestException,
  Param,
  Post,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Public } from '@common/decorators/public.decorator';
import { PrismaService } from '@common/prisma/prisma.service';
import { BusinessHoursService } from '@modules/business/business-hours.service';
import { TenantContext } from '@common/tenant/tenant-context.service';
import { OrdersService } from '@modules/orders/orders.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EVENTS } from '@common/events/events.constants';
import { z } from 'zod';

const PlaceWebOrderSchema = z.object({
  businessSlug: z.string().min(1),
  customerPhone: z.string().min(7).trim(),
  customerName: z.string().min(1).trim(),
  serviceType: z.enum(['DELIVERY', 'PICKUP', 'DINE_IN']),
  deliveryAddress: z.string().optional(),
  areaId: z.string().optional(),
  tableNumber: z.string().optional(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().uuid(),
        name: z.string(),
        quantity: z.number().int().min(1),
        unitPrice: z.number().min(0),
      }),
    )
    .min(1),
  notes: z.string().optional(),
});

type PlaceWebOrderInput = z.infer<typeof PlaceWebOrderSchema>;

@Public()
@Controller('public/menu')
export class PublicMenuController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businessHours: BusinessHoursService,
    private readonly tenant: TenantContext,
    private readonly ordersService: OrdersService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ----------------------------------------------------------------
  // GET /public/menu/:slug
  // ----------------------------------------------------------------
  @Get(':slug')
  async getMenu(@Param('slug') slug: string) {
    const business = await this.prisma.business.findFirst({
      where: { slug, isActive: true },
      include: { serviceConfig: true },
    });

    if (!business || !business.menuEnabled) {
      throw new NotFoundException('Menu not found');
    }

    const items = await this.prisma.menuItem.findMany({
      where: { businessId: business.id, isAvailable: true },
      orderBy: [{ category: 'asc' }, { sort: 'asc' }, { name: 'asc' }],
    });

    const grouped = new Map<string, typeof items>();
    for (const item of items) {
      if (!grouped.has(item.category)) grouped.set(item.category, []);
      grouped.get(item.category)!.push(item);
    }

    const categories = Array.from(grouped.entries()).map(([name, items]) => ({
      name,
      items: items.map((i) => ({ ...i, price: Number(i.price) })),
    }));

    const sc = business.serviceConfig;

    return {
      business: {
        name: business.name,
        slug: business.slug,
        logoUrl: business.logoUrl,
        primaryColor: business.primaryColor,
        currencySymbol: business.currencySymbol,
        tagline: business.tagline,
        bankName: business.bankName,
        bankAccountNumber: business.bankAccountNumber,
        bankAccountName: business.bankAccountName,
        estimatedDeliveryMin: business.estimatedDeliveryMin,
        estimatedDeliveryMax: business.estimatedDeliveryMax,
        serviceConfig: sc
          ? {
              areas: sc.areas,
              serviceChargePercent: sc.serviceChargePercent,
              vatPercent: sc.vatPercent,
            }
          : null,
      },
      categories,
    };
  }

  // ----------------------------------------------------------------
  // GET /public/menu/:slug/check-hours
  // ----------------------------------------------------------------
  @Get(':slug/check-hours')
  async checkHours(@Param('slug') slug: string) {
    const business = await this.prisma.business.findFirst({
      where: { slug, isActive: true, menuEnabled: true },
      select: { operatingHours: true, timezone: true },
    });

    if (!business) throw new NotFoundException('Menu not found');

    const isOpen = this.businessHours.isOpen(business.operatingHours, business.timezone);
    const nextOpeningTime = isOpen
      ? null
      : this.businessHours.nextOpeningTime(business.operatingHours, business.timezone);

    return { isOpen, nextOpeningTime };
  }

  // ----------------------------------------------------------------
  // POST /public/menu/orders
  // ----------------------------------------------------------------
  @Post('orders')
  @HttpCode(HttpStatus.CREATED)
  async placeOrder(@Body() body: unknown) {
    const parsed = PlaceWebOrderSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    const dto = parsed.data as PlaceWebOrderInput;

    // 1. Find business
    const business = await this.prisma.business.findFirst({
      where: { slug: dto.businessSlug, isActive: true, menuEnabled: true },
      include: { serviceConfig: true },
    });
    if (!business) throw new NotFoundException('Menu not found');

    // 2 & 3. Validate menu items exist, belong to this business, and are available
    const menuItems = await this.prisma.menuItem.findMany({
      where: {
        id: { in: dto.items.map((i) => i.menuItemId) },
        businessId: business.id,
      },
    });

    if (menuItems.length !== dto.items.length) {
      throw new BadRequestException('One or more menu items not found');
    }

    const unavailable = menuItems.filter((m) => !m.isAvailable);
    if (unavailable.length) {
      throw new BadRequestException(
        `These items are currently unavailable: ${unavailable.map((m) => m.name).join(', ')}`,
      );
    }

    // 4. Find or create customer scoped to this business
    const customer = await this.prisma.customer.upsert({
      where: {
        businessId_phone: { businessId: business.id, phone: dto.customerPhone },
      },
      create: {
        businessId: business.id,
        phone: dto.customerPhone,
        name: dto.customerName,
      },
      update: {
        name: dto.customerName,
      },
    });

    // 5. Calculate totals
    const sc = business.serviceConfig;
    const serviceChargePercent = sc?.serviceChargePercent ?? 0;
    const vatPercent = sc?.vatPercent ?? 0;

    const subtotal = dto.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

    let deliveryFee = 0;
    if (dto.serviceType === 'DELIVERY' && dto.areaId && sc) {
      const areas = sc.areas as { id: string; deliveryFee?: number }[];
      const area = areas.find((a) => a.id === dto.areaId);
      deliveryFee = area?.deliveryFee ?? 0;
    }

    const serviceCharge = (subtotal * serviceChargePercent) / 100;
    const vatAmount = ((subtotal + serviceCharge) * vatPercent) / 100;
    const total = subtotal + deliveryFee + serviceCharge + vatAmount;

    // 6 & 7. Create order + items — set tenant context first
    this.tenant.set(business.id, false);

    const order = await this.ordersService.create({
      customerId: customer.id,
      serviceType: dto.serviceType,
      sourceType: 'TEXT',
      deliveryAddress: dto.deliveryAddress,
      deliveryFee,
      notes: dto.notes,
      flowData: {
        serviceLabel: dto.serviceType,
        area: dto.areaId,
        tableNumber: dto.tableNumber,
        source: 'web_menu',
      },
      items: dto.items.map((i, idx) => ({
        name: i.name,
        nameLower: i.name.toLowerCase().trim(),
        quantity: String(i.quantity),
        unitPrice: i.unitPrice,
        sort: idx,
      })),
    });

    // Apply calculated pricing
    await this.prisma.order.update({
      where: { id: order.id },
      data: { subtotal, deliveryFee, serviceCharge, vatAmount, total },
    });

    // 9. Send WhatsApp confirmation — direct axios, no circular dep
    try {
      if (business.whatsappToken && business.whatsappPhoneId) {
        await axios.post(
          `https://graph.facebook.com/v19.0/${business.whatsappPhoneId}/messages`,
          {
            messaging_product: 'whatsapp',
            to: dto.customerPhone,
            type: 'text',
            text: {
              body:
                `Got your order! 🍽️\n\n` +
                `*Order ${order.orderNumber}* has been placed.\n\n` +
                `We're confirming your order now — we'll update you shortly!`,
            },
          },
          { headers: { Authorization: `Bearer ${business.whatsappToken}` } },
        );
      }
    } catch {
      // non-fatal
    }

    // 10. Fire ORDER_CREATED event
    this.eventEmitter.emit(EVENTS.ORDER_CREATED, { order: { ...order, businessId: business.id } });

    return {
      success: true,
      orderNumber: order.orderNumber,
      total: Math.round(total * 100) / 100,
      message: 'Order placed successfully',
    };
  }
}