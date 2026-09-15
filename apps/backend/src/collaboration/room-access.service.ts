import { Injectable } from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const ROOM_PASSWORD_MAX_LENGTH = 100;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 32;

type PasswordVerifier = {
  salt: Buffer;
  digest: Buffer;
};

/**
 * Opaque room-access metadata. The verifier is deliberately not a property of
 * this value so spreading or serializing a room cannot disclose password data.
 */
export type RoomAccess = Readonly<{
  requiresPassword: boolean;
}>;

@Injectable()
export class RoomAccessService {
  private readonly verifiers = new WeakMap<
    RoomAccess,
    PasswordVerifier | null
  >();

  validate(password: unknown): string | null {
    if (password === undefined) return null;
    if (typeof password !== 'string') return 'Room password must be text.';
    if (password.length > ROOM_PASSWORD_MAX_LENGTH)
      return `Room password must be at most ${ROOM_PASSWORD_MAX_LENGTH} characters.`;
    return null;
  }

  create(password?: string): RoomAccess {
    const error = this.validate(password);
    if (error) throw new Error(error);

    const protectedRoom = Boolean(password);
    const access = Object.freeze({
      requiresPassword: protectedRoom,
    });
    const salt = protectedRoom ? randomBytes(PASSWORD_SALT_BYTES) : null;
    this.verifiers.set(
      access,
      protectedRoom
        ? {
            salt: salt!,
            digest: this.digest(password!, salt!),
          }
        : null,
    );
    return access;
  }

  verify(access: RoomAccess, password?: string): boolean {
    if (!access.requiresPassword) return true;
    const verifier = this.verifiers.get(access);
    if (
      !verifier ||
      typeof password !== 'string' ||
      this.validate(password) !== null
    )
      return false;
    const candidate = scryptSync(password!, verifier.salt, PASSWORD_KEY_BYTES);
    return (
      candidate.length === verifier.digest.length &&
      timingSafeEqual(candidate, verifier.digest)
    );
  }

  private digest(password: string, salt: Buffer): Buffer {
    return scryptSync(password, salt, PASSWORD_KEY_BYTES);
  }
}
