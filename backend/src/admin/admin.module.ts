import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { DepartmentsController } from './departments.controller.js';
import { GroupsController } from './groups.controller.js';
import { InboxesController } from './inboxes.controller.js';
import { UsersController } from './users.controller.js';

@Module({ controllers: [UsersController, GroupsController, DepartmentsController, AuditController, InboxesController] })
export class AdminModule {}
