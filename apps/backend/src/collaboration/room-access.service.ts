import { Injectable } from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { RETRO_MAX_PASSWORD_LENGTH } from 'shared/retrospective';

export const ROOM_PASSWORD_MAX_LENGTH = RETRO_MAX_PASSWORD_LENGTH;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 32;

type PasswordVerifier = {
  salt: Buffer;
  digest: Buffer;
};

/**
 * Opaque room-access metadata used by the in-process Poker room registry. The
 * verifier is deliberately not a property of this value so spreading or
 * serializing a room cannot disclose password data.
 */
export type RoomAccess = Readonly<{
  requiresPassword: boolean;
}>;

/**
 * Durable access metadata for repositories. It contains only a salted password
 * digest, never the clear-text password. This is intentionally separate from
 * RoomAccess because the latter is a public projection used by Poker rooms.
 */
export interface StoredRoomAccess {
  requiresPassword: boolean;
  salt: string | null;
  digest: string | null;
}

export function validateRoomPassword(password: unknown): string | null {
  if (password === undefined) return null;
  if (typeof password !== 'string') return 'Room password must be text.';
  if (password.length > ROOM_PASSWORD_MAX_LENGTH)
    return `Room password must be at most ${ROOM_PASSWORD_MAX_LENGTH} characters.`;
  return null;
}

/** Create repository-safe access metadata without retaining the password. */
export function createStoredRoomAccess(password?: string): StoredRoomAccess {
  const error = validateRoomPassword(password);
  if (error) throw new Error(error);

  const protectedRoom = Boolean(password);
  if (!protectedRoom)
    return { requiresPassword: false, salt: null, digest: null };

  const salt = randomBytes(PASSWORD_SALT_BYTES);
  return {
    requiresPassword: true,
    salt: salt.toString('base64'),
    digest: scryptSync(password!, salt, PASSWORD_KEY_BYTES).toString('base64'),
  };
}

/** Verify a persisted digest in the same atomic repository operation as join. */
export function verifyStoredRoomAccess(
  access: StoredRoomAccess | undefined,
  password?: unknown,
): boolean {
  if (!access?.requiresPassword) return true;
  if (!access.salt || !access.digest || validateRoomPassword(password) !== null)
    return false;
  try {
    const candidate = scryptSync(
      password as string,
      Buffer.from(access.salt, 'base64'),
      PASSWORD_KEY_BYTES,
    );
    const expected = Buffer.from(access.digest, 'base64');
    return (
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected)
    );
  } catch {
    return false;
  }
}

@Injectable()
export class RoomAccessService {
  private readonly verifiers = new WeakMap<
    RoomAccess,
    PasswordVerifier | null
  >();

  validate(password: unknown): string | null {
    return validateRoomPassword(password);
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
    const candidate = scryptSync(password, verifier.salt, PASSWORD_KEY_BYTES);
    return (
      candidate.length === verifier.digest.length &&
      timingSafeEqual(candidate, verifier.digest)
    );
  }

  private digest(password: string, salt: Buffer): Buffer {
    return scryptSync(password, salt, PASSWORD_KEY_BYTES);
  }
}
