import { BadRequestException, Controller, HttpCode, Inject, NotFoundException, Param, Post, Req, ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
import type { Kysely } from 'kysely';
import { AuditService } from '../audit/audit.service.js';
import { type AuthUser, clientIp, CurrentUser, RequirePermission } from '../common/auth-user.js';
import { idParam, parse } from '../common/validation.js';
import { assertInboxAccess } from '../admin/inbox-access.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/schema.js';
import { BrandingService } from '../branding/branding.service.js';
import { MailService } from './mail.service.js';

/** Envio de e-mail de teste para os destinatários do setor. */
@Controller('admin/departments')
export class EmailAdminController {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly mail: MailService,
    private readonly branding: BrandingService,
    private readonly audit: AuditService,
  ) {}

  @Post(':id/email-test')
  @HttpCode(200)
  @RequirePermission('admin.email')
  async test(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Req() req: Request) {
    const id = parse(idParam, idRaw);
    const d = await this.db.selectFrom('departments').select(['id', 'name']).where('id', '=', id).where('organization_id', '=', user.organizationId).executeTakeFirst();
    if (!d) throw new NotFoundException('Caixa de entrada não encontrada.');
    assertInboxAccess(user, d.id);
    const to = (await this.db.selectFrom('email_recipients').select('email').where('department_id', '=', id).execute()).map((r) => r.email);
    if (!to.length) throw new BadRequestException('Cadastre ao menos um destinatário.');
    const name = await this.branding.systemName(user.organizationId);
    const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
    try {
      await this.mail.send({
        to,
        subject: `[TESTE] ${name} - ${d.name}`,
        text: `Este é um e-mail de teste do ${name}, enviado por ${user.name}.\nSe você recebeu, o envio de encerramentos está funcionando.`,
        html: `<p>Este é um e-mail de teste do <strong>${esc(name)}</strong>.</p><p>Se você recebeu, o envio de encerramentos está funcionando.</p>`,
      });
    } catch (err) {
      throw new ServiceUnavailableException(`Falha no envio: ${(err as Error).message}`);
    }
    await this.audit.log({ action: 'admin.email.test_sent', user, ip: clientIp(req), targetType: 'department', targetId: id, details: { recipients: to.length } });
    return { ok: true, recipients: to.length };
  }
}
