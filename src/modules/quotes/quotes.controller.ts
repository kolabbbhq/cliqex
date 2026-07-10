import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { JwtGuard } from '@modules/auth/guards/auth.guards';
import { QuotesService } from './quotes.service';
import { SendQuoteInput, UpdateItemPriceInput } from './schemas/quotes.schema';

@UseGuards(JwtGuard)
@Controller('orders/:orderId/quote')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Get('preview')
  async getPreview(@Param('orderId') orderId: string) {
    return this.quotesService.getPreview(orderId);
  }

  @Post('send')
  async sendQuote(@Param('orderId') orderId: string, @Body() input: SendQuoteInput) {
    return this.quotesService.sendQuote(orderId, input);
  }

  @Patch('items/:itemId')
  async updateItemPrice(
    @Param('orderId') orderId: string,
    @Param('itemId') itemId: string,
    @Body() input: UpdateItemPriceInput,
  ) {
    await this.quotesService.updateItemPrice(orderId, itemId, input);
    return { message: 'Item price updated' };
  }
}