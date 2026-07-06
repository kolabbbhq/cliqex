import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

export interface PriceSuggestion {
  itemName: string;
  suggestedPrice: number;
  confidence: number; // 0.0 – 1.0
  lastSeenPrice: number;
  lastSeenAt: Date;
  sampleSize: number; // how many past orders used
}

export interface OrderPriceSuggestions {
  orderId: string;
  suggestions: Record<string, PriceSuggestion | null>; // keyed by itemId
}

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ----------------------------------------------------------------
  // Get price suggestions for all items on an order
  // Called by CRM when admin opens a NEW order to price it
  // ----------------------------------------------------------------
  async getSuggestionsForOrder(orderId: string): Promise<OrderPriceSuggestions> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) return { orderId, suggestions: {} };

    const suggestions: Record<string, PriceSuggestion | null> = {};

    await Promise.all(
      order.items.map(async (item) => {
        const suggestion = await this.suggestPrice(item.name, order.serviceType);
        suggestions[item.id] = suggestion;
      }),
    );

    return { orderId, suggestions };
  }

  // ----------------------------------------------------------------
  // Suggest price for a single item name
  // Uses weighted average — recent prices count more than old ones
  // ----------------------------------------------------------------
  async suggestPrice(itemName: string, serviceType: string): Promise<PriceSuggestion | null> {
    const normalised = itemName.toLowerCase().trim();

    // Get last 20 records for this item — most recent first
    const history = await this.prisma.priceHistory.findMany({
      where: {
        itemName: { contains: normalised },
        serviceType,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    if (history.length === 0) return null;

    // Weighted average — newer entries get higher weight
    // Entry 0 (most recent) gets weight 20, entry 19 gets weight 1
    let weightedSum = 0;
    let totalWeight = 0;

    history.forEach((record, index) => {
      const weight = history.length - index;
      weightedSum += Number(record.price) * weight;
      totalWeight += weight;
    });

    const suggestedPrice = Math.round(weightedSum / totalWeight);

    // Confidence: more samples = higher confidence, caps at 1.0
    const confidence = Math.min(history.length / 10, 1.0);

    return {
      itemName: normalised,
      suggestedPrice,
      confidence: parseFloat(confidence.toFixed(2)),
      lastSeenPrice: Number(history[0].price),
      lastSeenAt: history[0].createdAt,
      sampleSize: history.length,
    };
  }
}
