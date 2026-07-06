import { Controller, Post, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtGuard } from '@modules/auth/guards/auth.guards';
import { TenantContext } from '@common/tenant/tenant-context.service';
import { FlowsService } from './flows.service';

@ApiTags('Flows')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('flows')
export class FlowsController {
  constructor(
    private readonly flowsService: FlowsService,
    private readonly tenant: TenantContext,
  ) {}

  // POST /api/v1/flows/resync
  @Post('resync')
  @ApiOperation({ summary: 'Re-sync and republish the WhatsApp Flow JSON for this business' })
  async resync() {
    const businessId = this.tenant.get();
    try {
      const flowId = await this.flowsService.resyncFlowForBusiness(businessId);
      return { message: 'Flow re-synced and republished', flowId };
    } catch (err: any) {
      throw new BadRequestException(
        err.response?.data?.error?.error_user_msg ?? err.message,
      );
    }
  }

  // POST /api/v1/flows/register
  // Allows admin to manually trigger flow registration after fixing credentials
  @Post('register')
  @ApiOperation({ summary: 'Manually trigger WhatsApp Flow registration for this business' })
  async register() {
    const businessId = this.tenant.get();
    try {
      const flowId = await this.flowsService.triggerRegistrationForBusiness(businessId);
      return { message: 'Flow registered successfully', flowId };
    } catch (err: any) {
      throw new BadRequestException(
        err.response?.data?.error?.error_user_msg ?? err.message,
      );
    }
  }
}