import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { OrdersService } from './orders.service';
import { ReviewsService } from '@modules/reviews/reviews.service';
import {
  ListOrdersDto,
  PriceAllItemsDto,
  CancelOrderDto,
  AssignBuddyDto,
  UpdateOrderNotesDto,
} from './dto/orders.dto';
import { JwtGuard } from '@modules/auth/guards/auth.guards';

@ApiTags('Orders')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService,
      private readonly reviewsService: ReviewsService,

  ) {}

  

  // GET /api/v1/orders?status=NEW&page=1
  @Get()
  @ApiOperation({ summary: 'List orders — CRM orders inbox' })
  async findAll(@Query() query: ListOrdersDto) {
    return this.ordersService.findAll(query);
  }
  @Get('inbox')
@ApiOperation({ summary: 'List orders grouped by customer — one row per customer, latest order' })
async findInbox(@Query() query: ListOrdersDto) {
  return this.ordersService.findInbox(query);
}

  // GET /api/v1/orders/:id
  @Get(':id')
  @ApiOperation({ summary: 'Get order detail with items' })
  async findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }

  // POST /api/v1/orders/:id/price — admin sets item prices + delivery fee
  @Post(':id/price')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Price all items and set delivery fee — sends quote' })
  async priceItems(@Param('id') id: string, @Body() dto: PriceAllItemsDto) {
    return this.ordersService.priceItems(id, dto);
  }
  

  // POST /api/v1/orders/:id/processing
  @Post(':id/processing')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark order as processing — shopping started' })
  async markProcessing(@Param('id') id: string) {
    return this.ordersService.markProcessing(id);
  }

  // POST /api/v1/orders/:id/assign
  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign a buddy to the order' })
  async assignBuddy(@Param('id') id: string, @Body() dto: AssignBuddyDto) {
    return this.ordersService.assignBuddy(id, dto);
  }

  // POST /api/v1/orders/:id/transit
  @Post(':id/transit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark order in transit — buddy on the way' })
  async markInTransit(@Param('id') id: string) {
    return this.ordersService.markInTransit(id);
  }

  // POST /api/v1/orders/:id/deliver
  @Post(':id/deliver')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark order as delivered' })
  async markDelivered(@Param('id') id: string) {
    return this.ordersService.markDelivered(id);
  }

  // POST /api/v1/orders/:id/cancel
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an order' })
  async cancel(@Param('id') id: string, @Body() dto: CancelOrderDto) {
    return this.ordersService.cancel(id, dto);
  }

  // PATCH /api/v1/orders/:id/notes
  @Patch(':id/notes')
  @ApiOperation({ summary: 'Update internal admin notes on order' })
  async updateNotes(@Param('id') id: string, @Body() dto: UpdateOrderNotesDto) {
    return this.ordersService.updateNotes(id, dto);
  }
  @Get(':orderId/review')
@ApiOperation({ summary: 'Get review for a specific order' })
async getOrderReview(@Param('orderId') orderId: string) {
  return this.reviewsService.findByOrderId(orderId);
}
}
