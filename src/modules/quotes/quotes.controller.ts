import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { JwtGuard } from '@modules/auth/guards/auth.guards';
import { QuotesService } from './quotes.service';
import { SendQuoteInput, UpdateItemPriceInput } from './schemas/quotes.schema';

@UseGuards(JwtGuard)
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Get(':orderId/preview')
  async getPreview(@Param('orderId') orderId: string) {
    return this.quotesService.getPreview(orderId);
  }

  @Post(':orderId/send')
  async sendQuote(@Param('orderId') orderId: string, @Body() input: SendQuoteInput) {
    return this.quotesService.sendQuote(orderId, input);
  }

  @Patch(':orderId/items/:itemId')
  async updateItemPrice(
    @Param('orderId') orderId: string,
    @Param('itemId') itemId: string,
    @Body() input: UpdateItemPriceInput,
  ) {
    await this.quotesService.updateItemPrice(orderId, itemId, input);
    return { message: 'Item price updated' };
  }
}
