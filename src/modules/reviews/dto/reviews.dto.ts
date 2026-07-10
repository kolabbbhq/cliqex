// src/modules/reviews/dto/reviews.dto.ts
import { createZodDto } from 'nestjs-zod'; // adjust import if you use a different zod-dto bridge
import { ListReviewsSchema } from '@modules/reviews/schemas/reviews.schema';

export class ListReviewsDto extends createZodDto(ListReviewsSchema) {}