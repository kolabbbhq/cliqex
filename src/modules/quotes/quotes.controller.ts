import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { QuotesService } from './quotes.service';
import { SendQuoteDto, UpdateItemPriceDto } from './dto/quotes.dto';
import { JwtGuard } from '@modules/auth/guards/auth.guards';

@ApiTags('Quotes')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('orders/:orderId/quote')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  // GET /api/v1/orders/:orderId/quote/preview
  // CRM loads this when admin opens an order to price it
  @Get('preview')
  @ApiOperation({ summary: 'Preview quote before sending — shows exact WhatsApp message' })
  async getPreview(@Param('orderId') orderId: string) {
    return this.quotesService.getPreview(orderId);
  }

  // POST /api/v1/orders/:orderId/quote/send
  // Admin prices all items + delivery fee + fires quote to customer
  @Post('send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Price items and send quote to customer via WhatsApp' })
  async sendQuote(@Param('orderId') orderId: string, @Body() dto: SendQuoteDto) {
    return this.quotesService.sendQuote(orderId, dto);
  }

  // PATCH /api/v1/orders/:orderId/quote/items/:itemId
  // Admin adjusts one item price without sending the quote yet
  @Patch('items/:itemId')
  @ApiOperation({ summary: 'Update price of a single item' })
  async updateItemPrice(
    @Param('orderId') orderId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateItemPriceDto,
  ) {
    await this.quotesService.updateItemPrice(orderId, itemId, dto);
    return { message: 'Item price updated' };
  }
}
