import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';

import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { WhatsappService } from './whatsapp.service';
import { WhatsAppWebhookPayload } from './whatsapp.types';
import { Public } from '@common/decorators/public.decorator';
import { JwtGuard } from '@modules/auth/guards/auth.guards';
import { WhatsAppFlowWebhookPayload } from './whatsapp.types';


@ApiTags('WhatsApp')
@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  // ----------------------------------------------------------------
  // GET /api/v1/whatsapp/webhook
  // Public — Meta calls this once to verify your webhook URL
  // ----------------------------------------------------------------
  @Public()
  @Get('webhook')
  @ApiOperation({ summary: 'Meta webhook verification' })
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const result = this.whatsappService.verifyWebhook(mode, token, challenge);

    if (result) {
      return res.status(200).send(result);
    }

    return res.sendStatus(403);
  }


  
  // ----------------------------------------------------------------
  // POST /api/v1/whatsapp/webhook
  // Public — Meta sends every customer message here
  // Must return 200 quickly or Meta will retry
  // ----------------------------------------------------------------
 @Public()
@Post('webhook')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Receive inbound WhatsApp messages from Meta' })
async receiveWebhook(
  @Body() payload: any,
  @Res() res: Response,
) {
  // Flow data_exchange calls have encrypted fields
  if (payload.encrypted_flow_data && payload.encrypted_aes_key) {
    const result = await this.whatsappService.handleFlowWebhook(payload);
    return res.send(result);
  }

  // Normal WhatsApp messages — fire and forget
  this.whatsappService.handleWebhook(payload).catch((err) => {
    console.error('Webhook processing error:', err);
  });
  return res.json({ status: 'ok' });
}

  @Public()
@Post('flow-webhook')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'WhatsApp Flow data exchange endpoint' })
async flowWebhook(@Body() payload: WhatsAppFlowWebhookPayload, @Res() res: Response) {
  // For now just return a ping response — we'll expand this for the table summary
  return res.json({
    screen: 'SCREEN_SUMMARY',
    data: {},
  });
}
  // ----------------------------------------------------------------
  // GET /api/v1/whatsapp/thread/:orderId
  // Protected — CRM uses this to load the chat thread for an order
  // ----------------------------------------------------------------
  @UseGuards(JwtGuard)
  @Get('thread/:orderId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get WhatsApp conversation thread for an order' })
  async getOrderThread(@Param('orderId') orderId: string) {
    return this.whatsappService.getOrderThread(orderId);
  }

  @UseGuards(JwtGuard)
@Post('thread/:orderId/reply')
@HttpCode(HttpStatus.OK)
@ApiBearerAuth()
@ApiOperation({ summary: 'Admin sends a manual WhatsApp message for this order' })
async replyToOrder(
  @Param('orderId') orderId: string,
  @Body() dto: { message: string },
) {
  await this.whatsappService.sendManualReply(orderId, dto.message);
  return { message: 'Reply sent' };
}
}
