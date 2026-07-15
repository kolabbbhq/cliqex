import { Injectable, Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/ws',
})
@Injectable()
export class AppGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(AppGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  emitToBusinessAdmins(businessId: string, event: string, data: any) {
    this.server.to(`business:${businessId}`).emit(event, data);
  }

  @SubscribeMessage('join')
  handleJoin(client: Socket, payload: { businessId: string }) {
    if (!payload?.businessId) return;
    client.join(`business:${payload.businessId}`);
    this.logger.log(`Client ${client.id} joined business:${payload.businessId}`);
  }
}