import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { OrdersService } from '@modules/orders/orders.service';
import { WhatsappService } from '@modules/whatsapp/whatsapp.service';
import { PdfService } from '@modules/pdf/pdf.service';
import { UploadService } from '@modules/upload/upload.service';
import { BusinessService } from '@modules/business/business.service';
import { Templates } from '@modules/whatsapp/templates/messages.template';
import { SendQuoteInput, UpdateItemPriceInput } from './schemas/quotes.schema';
import { QuotePreview, SendQuoteResult } from './quotes.types';

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly whatsappService: WhatsappService,
    private readonly pdfService: PdfService,
    private readonly uploadService: UploadService,
    private readonly businessService: BusinessService,
  ) {}

  // ----------------------------------------------------------------
  // Get quote preview — CRM shows this before admin hits Send
  // Stays as TEXT — this is the admin-facing preview only, not what
  // the customer receives. The customer now gets a PDF (see sendQuote).
  // ----------------------------------------------------------------
  async getPreview(orderId: string): Promise<QuotePreview> {
    const order = await this.ordersService.findOne(orderId);
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    if (order.status !== 'NEW') {
      throw new BadRequestException(`Cannot preview quote for order with status ${order.status}`);
    }

    const subtotal = order.items.reduce((sum, item) => {
      const qty = parseInt(item.quantity, 10) || 1;
      return sum + Number(item.unitPrice ?? 0) * qty;
    }, 0);

    const template = Templates.quote({
      customerName: order.customer.name,
      orderNumber: order.orderNumber,
      areaLabel: (order.flowData as any)?.areaLabel,
      items: order.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice ?? 0),
      })),
      deliveryFee: Number(order.deliveryFee),
      subtotal,
      serviceCharge: order.serviceCharge,
      vatAmount: order.vatAmount,
      total: subtotal + Number(order.deliveryFee) + order.serviceCharge + order.vatAmount,
      serviceType: order.serviceType,
    });

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      customer: order.customer,
      serviceType: order.serviceType,
      items: order.items as any,
      subtotal,
      deliveryFee: Number(order.deliveryFee),
      serviceCharge: order.serviceCharge,
      vatAmount: order.vatAmount,
      total: subtotal + Number(order.deliveryFee) + order.serviceCharge + order.vatAmount,
      whatsappPreview: template.body,
    };
  }

  // ----------------------------------------------------------------
  // Send quote — admin's main action
  // 1. Prices all items
  // 2. Calculates totals
  // 3. Moves order to QUOTED
  // 4. Generates a PDF invoice and sends it as a WhatsApp document
  // 5. Sends a short follow-up text with Confirm/Cancel buttons
  // 6. Writes price history for AI learning
  // ----------------------------------------------------------------
  async sendQuote(orderId: string, input: SendQuoteInput): Promise<SendQuoteResult> {
    const order = await this.ordersService.findOne(orderId);
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    if (order.status !== 'NEW') {
      throw new BadRequestException(
        `Cannot send quote for order with status ${order.status}. Order must be NEW.`,
      );
    }

    const orderItemIds = new Set(order.items.map((i) => i.id));
    const invalidItems = input.items.filter((i) => !orderItemIds.has(i.itemId));
    if (invalidItems.length > 0) {
      throw new BadRequestException(
        `Item IDs not found on this order: ${invalidItems.map((i) => i.itemId).join(', ')}`,
      );
    }

    // priceItems computes serviceCharge + vatAmount internally,
    // respecting per-service chargeRules
    const updatedOrder = await this.ordersService.priceItems(orderId, {
      items: input.items,
      deliveryFee: input.deliveryFee,
    });

    const business = await this.businessService.getById(order.businessId);

    // ── 1. Generate PDF quote invoice ────────────────────────────
    const pdfBuffer = await this.pdfService.generateQuoteInvoice({
      order: updatedOrder,
      business,
    });

    // ── 2. Upload to Cloudinary ───────────────────────────────────
    const { url } = await this.uploadService.uploadDocument(
      pdfBuffer,
      order.businessId,
      `Quote-${order.orderNumber}.pdf`,
    );

    // ── 3. Send PDF as WhatsApp document ──────────────────────────
  await this.whatsappService.sendDocument({
  to: order.customer.phone,
  documentUrl: url,
  filename: `Quote-${order.orderNumber}.pdf`,
  caption: `Your quote is ready 🧾`,
  token: business.whatsappToken!,
  phoneId: business.whatsappPhoneId!,
});


    // ── 4. Short follow-up text with action buttons ───────────────
   await this.whatsappService.sendButtons({
  to: order.customer.phone,
  body: `Tap below to confirm your order:`,
  buttons: [
    { id: 'CONFIRM_ORDER', title: '✅ Confirm order' },
    { id: 'CANCEL_ORDER', title: '❌ Cancel' },
  ],
  token: business.whatsappToken!,
});

    // ── 5. Price history for AI learning ──────────────────────────
    await this.writePriceHistory(orderId, order.serviceType, input.items, order.items);

    this.logger.log(
      `Quote PDF sent for ${order.orderNumber} — ₦${updatedOrder.total.toLocaleString()} to ${order.customer.phone}`,
    );

    return {
      success: true,
      orderNumber: order.orderNumber,
      total: updatedOrder.total,
      sentAt: new Date(),
    };
  }

  // ----------------------------------------------------------------
  // Update a single item price — admin adjusts one line
  // Does NOT send the quote — use sendQuote for that
  // ----------------------------------------------------------------
  async updateItemPrice(
    orderId: string,
    itemId: string,
    input: UpdateItemPriceInput,
  ): Promise<void> {
    const order = await this.ordersService.findOne(orderId);

    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    const item = order.items.find((i) => i.id === itemId);

    if (!item) {
      throw new NotFoundException(`Item ${itemId} not found on order ${orderId}`);
    }

    if (!['NEW', 'QUOTED'].includes(order.status)) {
      throw new BadRequestException('Can only edit prices on NEW or QUOTED orders');
    }

    await this.prisma.orderItem.update({
      where: { id: itemId },
      data: { unitPrice: input.unitPrice },
    });
  }

  // ----------------------------------------------------------------
  // Private: write every priced item to price_history
  // This is the data the AI uses to suggest prices on future orders
  // ----------------------------------------------------------------
  private async writePriceHistory(
    orderId: string,
    serviceType: any,
    pricedItems: { itemId: string; unitPrice: number }[],
    orderItems: { id: string; name: string; nameLower?: string }[],
  ): Promise<void> {
    const records = pricedItems.map((priced) => {
      const item = orderItems.find((i) => i.id === priced.itemId)!;
      return {
        orderId,
        serviceType,
        itemName: item.name.toLowerCase().trim(),
        price: priced.unitPrice,
      };
    });

    await this.prisma.priceHistory.createMany({ data: records });
  }
}