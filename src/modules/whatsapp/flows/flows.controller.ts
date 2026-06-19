import { Controller, Post, UseGuards } from '@nestjs/common';
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
  // Re-pushes errandsbuddy.flow.json to Meta for this business's existing Flow
  @Post('resync')
  @ApiOperation({ summary: 'Re-sync and republish the WhatsApp Flow JSON for this business' })
  async resync() {
    const businessId = this.tenant.get();
    const flowId = await this.flowsService.resyncFlowForBusiness(businessId);
    return { message: 'Flow re-synced and republished', flowId };
  }
}