import { Customer } from '@prisma/client';
import {
  CustomerWithStats,
  FindOrCreateResult,
  PaginatedCustomers,
} from '@modules/customers/customers.types';
import {
  ListCustomersInput,
   UpdateCustomerInput,

} from '@modules/customers/schemas/customers.schema';
import { CustomersRepository } from '@modules/customers/customers.repository';
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';




@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(private readonly customersRepository: CustomersRepository) {}
  async findOrCreate(phone: string): Promise<FindOrCreateResult> {
    const result = await this.customersRepository.findOrCreate(phone);

    if (result.isNew) {
      this.logger.log(`New customer created: ${phone}`);
    }

    return result;
  }

  async findAll(input: ListCustomersInput): Promise<PaginatedCustomers> {
    return this.customersRepository.findAll(input);
  }

  async findOne(id: string): Promise<CustomerWithStats> {
    const customer = await this.customersRepository.findWithStats(id);

    if (!customer) {
      throw new NotFoundException(`Customer ${id} not found`);
    }

    return customer;
  }
  async update(id: string, data: UpdateCustomerInput): Promise<Customer> {
    const exists = await this.customersRepository.findById(id);

    if (!exists) {
      throw new NotFoundException(`Customer ${id} not found`);
    }

    return this.customersRepository.update(id, data);
  }

  async block(id: string): Promise<void> {
    const customer = await this.customersRepository.findById(id);

    if (!customer) throw new NotFoundException(`Customer ${id} not found`);
    if (customer.isBlocked) throw new BadRequestException('Customer is already blocked');

    await this.customersRepository.setBlocked(id, true);
    this.logger.log(`Customer blocked: ${customer.phone}`);
  }


  async unblock(id: string): Promise<void> {
    const customer = await this.customersRepository.findById(id);

    if (!customer) throw new NotFoundException(`Customer ${id} not found`);
    if (!customer.isBlocked) throw new BadRequestException('Customer is not blocked');

    await this.customersRepository.setBlocked(id, false);
    this.logger.log(`Customer unblocked: ${customer.phone}`);
  }


  async incrementStats(customerId: string, orderTotal: number): Promise<void> {
    await this.customersRepository.incrementStats(customerId, orderTotal);
  }
}
