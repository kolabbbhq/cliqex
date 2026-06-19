import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PricingService } from './pricing.service';
import { JwtGuard } from '@modules/auth/guards/auth.guards';

@ApiTags('Pricing')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  // GET /api/v1/pricing/order/:orderId
  // CRM calls this when admin opens an order — gets AI suggestions for all items
  @Get('order/:orderId')
  @ApiOperation({ summary: 'Get AI price suggestions for all items in an order' })
  async getSuggestionsForOrder(@Param('orderId') orderId: string) {
    return this.pricingService.getSuggestionsForOrder(orderId);
  }

  // GET /api/v1/pricing/suggest?item=tomatoes&serviceType=GROCERY
  // Single item lookup — used for quick search in CRM
  @Get('suggest')
  @ApiOperation({ summary: 'Get price suggestion for a single item' })
  async suggestPrice(@Query('item') item: string, @Query('serviceType') serviceType: any) {
    return this.pricingService.suggestPrice(item, serviceType);
  }
}
