import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { OrdersService } from '@modules/orders/orders.service';
import { WhatsappService } from '@modules/whatsapp/whatsapp.service';
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
  ) {}

  // ----------------------------------------------------------------
  // Get quote preview — CRM shows this before admin hits Send
  // Includes the exact WhatsApp message that will be sent
  // ----------------------------------------------------------------
  async getPreview(orderId: string): Promise<QuotePreview> {
    const order = await this.ordersService.findOne(orderId);

    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    if (order.status !== 'NEW') {
      throw new BadRequestException(`Cannot preview quote for order with status ${order.status}`);
    }

    const subtotal = order.items.reduce((sum, item) => sum + Number(item.unitPrice ?? 0), 0);

    const total = subtotal + order.deliveryFee;

    const template = Templates.quote({
      customerName: order.customer.name,
      orderNumber: order.orderNumber,
      items: order.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice ?? 0),
      })),
      deliveryFee: Number(order.deliveryFee),
      subtotal,
      total: subtotal + Number(order.deliveryFee),
    });

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      customer: order.customer,
      serviceType: order.serviceType,
      items: order.items.map((item: any) => ({
        ...item,
        unitPrice: item.unitPrice ? Number(item.unitPrice) : null,
      })) as any,
      subtotal, // ← add this line
      deliveryFee: Number(order.deliveryFee),
      total: subtotal + Number(order.deliveryFee),
      whatsappPreview: template.body,
    };
  }

  // ----------------------------------------------------------------
  // Send quote — admin's main action
  // 1. Prices all items
  // 2. Calculates totals
  // 3. Moves order to QUOTED
  // 4. Sends WhatsApp message with reply buttons
  // 5. Writes price history for AI learning
  // ----------------------------------------------------------------
  async sendQuote(orderId: string, input: SendQuoteInput): Promise<SendQuoteResult> {
    const order = await this.ordersService.findOne(orderId);

    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    if (order.status !== 'NEW') {
      throw new BadRequestException(
        `Cannot send quote for order with status ${order.status}. Order must be NEW.`,
      );
    }
  //  async sendUpdate(orderId: string, input: SendQuoteInput): Promise<SendQuoteResult>{
  //   const order = await this.ordersService.findOne(orderId)
  //   if (!order) throw new NotFoundException(`Order ${orderId} not found`);
  //   if (order.status !== 'NEW'){
  //     throw new BadRequestException(`Cannot send quote for order with status ${order.status}. Order must be NEW.`,)
  //   }
  //  }

    // Validate all item IDs belong to this order
    const orderItemIds = new Set(order.items.map((i) => i.id));
    const invalidItems = input.items.filter((i) => !orderItemIds.has(i.itemId));

    if (invalidItems.length > 0) {
      throw new BadRequestException(
        `Item IDs not found on this order: ${invalidItems.map((i) => i.itemId).join(', ')}`,
      );
    }

    // Price items + update order totals + move to QUOTED (via OrdersService)
    const updatedOrder = await this.ordersService.priceItems(orderId, {
      items: input.items,
      deliveryFee: input.deliveryFee,
    });

    // Build quote message
    const template = Templates.quote({
      customerName: order.customer.name,
      orderNumber: order.orderNumber,
      items: input.items.map((priced) => {
        const item = order.items.find((i) => i.id === priced.itemId)!;
        return {
          name: item.name,
          quantity: item.quantity,
          unitPrice: priced.unitPrice,
        };
      }),
      deliveryFee: input.deliveryFee,
      subtotal: input.items.reduce((sum, i) => sum + i.unitPrice, 0),
      total: Number(updatedOrder.total),
    });

    // Send to customer via WhatsApp
    await this.whatsappService.sendButtons({
      to: order.customer.phone,
      body: template.body,
      buttons: template.buttons,
    });

    // Write price history — AI learns from every confirmed price
    await this.writePriceHistory(orderId, order.serviceType, input.items, order.items);

    this.logger.log(
      `Quote sent for ${order.orderNumber} — ₦${updatedOrder.total.toLocaleString()} to ${order.customer.phone}`,
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
