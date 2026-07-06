import { Buddy } from '@prisma/client';
import { OnEvent } from '@nestjs/event-emitter';

import {
  CreateBuddyInput,
  UpdateBuddyInput,
  ListBuddiesInput,
  UpdateBuddyStatusInput,
} from '@modules/buddies/schemas/buddies.schema';

import { EVENTS } from '@common/events/events.constants';
import { PaginatedBuddies } from '@modules/buddies/buddies.types';
import { BuddiesRepository } from '@modules/buddies/buddies.repository';
import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';

@Injectable()
export class BuddiesService {
  private readonly logger = new Logger(BuddiesService.name);

  constructor(private readonly buddiesRepository: BuddiesRepository) {}

 async create(data: CreateBuddyInput): Promise<Buddy> {
  if (data.phone) {
    const existing = await this.buddiesRepository.findByPhone(data.phone);
    if (existing) {
      throw new ConflictException(`A buddy with phone ${data.phone} already exists`);
    }
  }
  const buddy = await this.buddiesRepository.create(data);
  this.logger.log(`Buddy created: ${buddy.name}`);
  return buddy;
}

  async findAll(input: ListBuddiesInput): Promise<PaginatedBuddies> {
    return this.buddiesRepository.findAll(input);
  }

  async findAvailable(serviceType?: string): Promise<Buddy[]> {
    return this.buddiesRepository.findAvailable(serviceType);
  }

  async findOne(id: string): Promise<Buddy> {
    const buddy = await this.buddiesRepository.findById(id);
    if (!buddy) throw new NotFoundException(`Buddy ${id} not found`);
    return buddy;
  }

  async update(id: string, data: UpdateBuddyInput): Promise<Buddy> {
  await this.findOne(id);
  if (data.phone) {
    const existing = await this.buddiesRepository.findByPhone(data.phone);
    if (existing && existing.id !== id) {
      throw new ConflictException(`Phone ${data.phone} already used by another buddy`);
    }
  }
  return this.buddiesRepository.update(id, data);
}

  async updateStatus(id: string, input: UpdateBuddyStatusInput): Promise<Buddy> {
    await this.findOne(id);
    return this.buddiesRepository.updateStatus(id, input.status as any);
  }

  @OnEvent(EVENTS.BUDDY_ASSIGNED)
  async onBuddyAssigned(payload: { buddyId: string }) {
    await this.buddiesRepository.updateStatus(payload.buddyId, 'BUSY' as any);
    this.logger.log(`Buddy ${payload.buddyId} set to BUSY`);
  }

  @OnEvent(EVENTS.ORDER_DELIVERED)
  async onOrderDelivered(payload: { order: any }) {
    if (!payload.order.buddyId) return;

    await this.buddiesRepository.recordDelivery(payload.order.buddyId);
    this.logger.log(`Buddy ${payload.order.buddyId} set back to AVAILABLE after delivery`);
  }
}
