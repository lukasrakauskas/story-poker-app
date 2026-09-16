import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Header,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type {
  RetroRememberedIdentity,
  RetroSessionView,
} from 'shared/retrospective';
import { sourceKeyFromUpgradeRequest } from '../transport/websocket-admission.service.js';
import { OriginAllowlistService } from '../transport/origin-allowlist.service.js';
import { WebSocketTransportService } from '../transport/websocket-transport.service.js';
import { RetroApplicationService } from './retro-application.service.js';
import {
  retroCodeSchema,
  retroSessionEstablishmentSchema,
} from './retro.schema.js';
import { RetroError } from './retro.service.js';
import { RetroSessionCookieService } from './retro-session-cookie.service.js';

const statusByError: Record<string, number> = {
  'session-required': 401,
  'invalid-session': 401,
  forbidden: 403,
  'http-required': 426,
  'room-expired': 410,
  'room-closed': 409,
  'name-taken': 409,
  capacity: 409,
  'wrong-room-password': 401,
  'rate-limit': 429,
};

/** HTTP is the only boundary allowed to establish or rotate a cookie. */
@Controller('retro')
export class RetroSessionController {
  constructor(
    private readonly application: RetroApplicationService,
    private readonly cookies: RetroSessionCookieService,
    private readonly transport: WebSocketTransportService,
    private readonly origins: OriginAllowlistService,
  ) {}

  @Post('session')
  @Header('Cache-Control', 'no-store')
  async establish(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RetroSessionView> {
    this.assertOrigin(request);
    const parsed = retroSessionEstablishmentSchema.safeParse(body);
    if (!parsed.success) this.failInvalidCommand();
    const source = sourceKeyFromUpgradeRequest(request);

    try {
      const established = await this.application.establish(parsed.data, source);
      this.cookies.set(
        response,
        established.session.code,
        established.session.token,
        established.view.room.expiresAt,
      );
      this.transport.dispatch(established.transport);
      return established.view;
    } catch (error) {
      return this.fail(error);
    }
  }

  @Post('session/:code/resume')
  @Header('Cache-Control', 'no-store')
  async resume(
    @Param('code') code: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RetroSessionView> {
    this.assertOrigin(request);
    this.validateCode(code);
    const token = this.cookies.read(request, code);
    if (!token)
      return this.fail(
        new RetroError(
          'session-required',
          'Establish this room session before reconnecting.',
        ),
      );

    try {
      const resumed = await this.application.resumeSession(
        code,
        token,
        sourceKeyFromUpgradeRequest(request),
      );
      this.cookies.set(
        response,
        code,
        resumed.session.token,
        resumed.view.room.expiresAt,
      );
      this.transport.dispatch(resumed.transport);
      return resumed.view;
    } catch (error) {
      // Failed rotations never clear a cookie. A delayed old response or a
      // displaced socket must not erase a newer valid browser session.
      return this.fail(error);
    }
  }

  @Get('session/:code')
  @Header('Cache-Control', 'no-store')
  async inspect(
    @Param('code') code: string,
    @Req() request: Request,
  ): Promise<RetroRememberedIdentity> {
    this.assertOrigin(request);
    this.validateCode(code);
    const token = this.cookies.read(request, code);
    if (!token)
      return this.fail(
        new RetroError(
          'session-required',
          'No remembered session exists for this room.',
        ),
      );
    try {
      return await this.application.inspectSession(
        code,
        token,
        sourceKeyFromUpgradeRequest(request),
      );
    } catch (error) {
      return this.fail(error);
    }
  }

  @Delete('session/:code')
  @Header('Cache-Control', 'no-store')
  async forget(
    @Param('code') code: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ forgotten: true }> {
    this.assertOrigin(request);
    this.validateCode(code);
    const token = this.cookies.read(request, code);
    if (!token)
      return this.fail(
        new RetroError(
          'session-required',
          'No remembered session exists for this room.',
        ),
      );
    try {
      const result = await this.application.forgetSession(
        code,
        token,
        sourceKeyFromUpgradeRequest(request),
      );
      this.cookies.clear(response, code);
      this.transport.dispatch(result);
      return { forgotten: true };
    } catch (error) {
      // Do not clear on a failed/stale forget request: another tab may have
      // already rotated the shared cookie to a valid session.
      return this.fail(error);
    }
  }

  private validateCode(code: string): void {
    if (!retroCodeSchema.safeParse(code).success) this.failInvalidCommand();
  }

  private assertOrigin(request: Request): void {
    const origin = request.headers.origin;
    if (
      (origin !== undefined && typeof origin !== 'string') ||
      !this.origins.isAllowed(typeof origin === 'string' ? origin : undefined)
    )
      throw new HttpException(
        {
          code: 'origin-not-allowed',
          message: 'This origin is not allowed to use retrospective sessions.',
        },
        403,
      );
  }

  private failInvalidCommand(): never {
    throw new HttpException(
      {
        code: 'invalid-command',
        message: 'Check the retrospective session request.',
      },
      400,
    );
  }

  private fail(error: unknown): never {
    if (!(error instanceof RetroError)) throw error;
    throw new HttpException(
      { code: error.code, message: error.message },
      statusByError[error.code] ?? 400,
    );
  }
}
