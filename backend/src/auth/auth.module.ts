import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';
import { UserLoaderService } from './user-loader.service.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [SessionService, PasswordService, UserLoaderService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [SessionService, PasswordService, UserLoaderService],
})
export class AuthModule {}
