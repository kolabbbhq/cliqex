// src/modules/reviews/reviews.controller.ts
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '@modules/auth/guards/auth.guards';
import { RolesGuard } from '@modules/auth/guards/roles.guard';
import { ReviewsService } from '@modules/reviews/reviews.service';
import { ListReviewsDto } from './dto/reviews.dto';

@UseGuards(JwtGuard, RolesGuard)
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  findAll(@Query() query: ListReviewsDto) {
    return this.reviewsService.findAll(query);
  }

  @Get('stats')
  getStats(@Query('buddyId') buddyId?: string) {
    return this.reviewsService.getStats(buddyId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.reviewsService.findOne(id);
  }
}