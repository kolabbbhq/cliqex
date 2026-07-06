import { Controller, Get, Query, UseGuards, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { ReviewsService } from './reviews.service';
import { JwtGuard } from '@modules/auth/guards/auth.guards';
import { ListReviewsDto } from './dto/reviews.dto';
@ApiTags('Reviews')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  // GET /api/v1/reviews?rating=5&page=1&limit=20
  @Get()
  @ApiOperation({ summary: 'List reviews — paginated, optional rating filter' })
  async findAll(@Query() query: ListReviewsDto) {
    return this.reviewsService.findAll(query);
  }

  // GET /api/v1/reviews/summary
  @Get('summary')
  @ApiOperation({ summary: 'Review summary stats — average, total, breakdown' })
  async getSummary() {
    return this.reviewsService.getSummary();
  }
}
