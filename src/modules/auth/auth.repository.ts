import { Injectable } from '@nestjs/common';
import { Admin, AdminRole } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { CreateAdminInput } from '@modules/auth/schemas/auth.schema';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<Admin | null> {
    return this.prisma.admin.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
  }

  async findById(id: string): Promise<Admin | null> {
    return this.prisma.admin.findUnique({
      where: { id },
    });
  }

  async create(data: CreateAdminInput & { passwordHash: string }): Promise<Admin> {
    return this.prisma.admin.create({
      data: {
        name: data.name,
        email: data.email.toLowerCase().trim(),
        passwordHash: data.passwordHash,
        role: data.role as AdminRole,
      },
    });
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.prisma.admin.update({
      where: { id },
      data: { passwordHash },
    });
  }

  async hasAnyAdmin(): Promise<boolean> {
    const count = await this.prisma.admin.count();
    return count > 0;
  }

  async findAll(): Promise<Omit<Admin, 'passwordHash'>[]> {
    return this.prisma.admin.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
         businessId: true,   // ✅ ADD THIS LINE
        isActive: true,
        createdAt: true,
        updatedAt: true,
        passwordHash: false,
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}
