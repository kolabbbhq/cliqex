
import { AnalyticsService } from './analytics.service';
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtGuard } from '@modules/auth/guards/auth.guards';

@UseGuards(JwtGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get()
  getDashboard() {
    return this.analyticsService.getDashboardStats();
  }

  @Get('notifications/count')
  getNotificationCounts() {
    return this.analyticsService.getNotificationCounts();
  }
}