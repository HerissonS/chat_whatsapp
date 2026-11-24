import { createReadStream } from 'node:fs';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { fileTypeFromBuffer } from 'file-type';
import { memoryStorage } from 'multer';
import { AuditService } from '../audit/audit.service.js';
import { type AuthUser, clientIp, CurrentUser, Public, RequirePermission } from '../common/auth-user.js';
import { parse } from '../common/validation.js';
import { BrandingService, brandingSchema, LOGO_SLOTS, type LogoSlot } from './branding.service.js';

const LOGO_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

function slotOf(raw: string): LogoSlot {
  if (!(LOGO_SLOTS as readonly string[]).includes(raw)) throw new NotFoundException('Logo inexistente.');
  return raw as LogoSlot;
}

@Controller()
export class BrandingController {
  constructor(
    private readonly branding: BrandingService,
    private readonly audit: AuditService,
  ) {}

  /** Aparência pública (a tela de login também usa). */
  @Public()
  @Get('branding')
  get() {
    return this.branding.publicView(1);
  }

  @Public()
  @Get('branding/logo/:slot')
  async logo(@Param('slot') slotRaw: string, @Res() res: Response) {
    const file = await this.branding.logoFile(1, slotOf(slotRaw));
    if (!file) {
      res.status(404).end();
      return;
    }
    const { path, mime } = file;
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    createReadStream(path)
      .on('error', () => res.status(404).end())
      .pipe(res);
  }

  @Put('admin/branding')
  @RequirePermission('admin.branding')
  async update(@CurrentUser() user: AuthUser, @Body() body: unknown, @Req() req: Request) {
    const data = parse(brandingSchema, body);
    await this.branding.update(user.organizationId, data);
    await this.audit.log({ action: 'admin.branding.updated', user, ip: clientIp(req) });
    return this.branding.publicView(user.organizationId);
  }

  @Post('admin/branding/reset')
  @HttpCode(200)
  @RequirePermission('admin.branding')
  async reset(@CurrentUser() user: AuthUser, @Req() req: Request) {
    await this.branding.reset(user.organizationId);
    await this.audit.log({ action: 'admin.branding.reset', user, ip: clientIp(req) });
    return this.branding.publicView(user.organizationId);
  }

  /** Upload de logo: PNG, JPG ou WebP até 2 MB. O tipo é conferido pelo conteúdo real do arquivo. */
  @Post('admin/branding/logo/:slot')
  @HttpCode(200)
  @RequirePermission('admin.branding')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_LOGO_BYTES, files: 1 } }))
  async uploadLogo(
    @CurrentUser() user: AuthUser,
    @Param('slot') slotRaw: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    const slot = slotOf(slotRaw);
    if (!file?.buffer?.length) throw new BadRequestException('Envie um arquivo de imagem.');
    const type = await fileTypeFromBuffer(file.buffer);
    const ext = type ? LOGO_TYPES[type.mime] : undefined;
    if (!type || !ext) throw new BadRequestException('Formato não suportado. Use PNG, JPG ou WebP.');
    await this.branding.setLogo(user.organizationId, slot, file.buffer, type.mime, ext);
    await this.audit.log({ action: 'admin.branding.logo_updated', user, ip: clientIp(req), details: { slot, size: file.size } });
    return this.branding.publicView(user.organizationId);
  }

  @Delete('admin/branding/logo/:slot')
  @RequirePermission('admin.branding')
  async removeLogo(@CurrentUser() user: AuthUser, @Param('slot') slotRaw: string, @Req() req: Request) {
    const slot = slotOf(slotRaw);
    await this.branding.removeLogo(user.organizationId, slot);
    await this.audit.log({ action: 'admin.branding.logo_removed', user, ip: clientIp(req), details: { slot } });
    return this.branding.publicView(user.organizationId);
  }
}
