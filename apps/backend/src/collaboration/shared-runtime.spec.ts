import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// Nest's default runner uses Node even when launched with `bun run dev`.
// Bundler/Vitest resolution alone does not catch extensionless ESM imports.
describe('shared package runtime exports', () => {
  it.each(['node', 'bun'])(
    'loads public entry points with %s native resolution',
    (runtime) => {
      const script = `
      const root = await import('shared');
      const participant = await import('shared/participant');
      const retro = await import('shared/retrospective');
      const priorities = await import('shared/retro-priorities');
      if (root.normalizeParticipantName(' Alice ') !== 'Alice') throw new Error('root export');
      if (!participant.participantNameSchema.safeParse(' Alice ').success) throw new Error('participant schema');
      if (!retro.retroCommandSchema.safeParse({ type: 'create', name: 'Alice', title: 'Runtime' }).success) throw new Error('retro schema');
      if (!Object.keys(priorities).length) throw new Error('priority exports');
      console.log('runtime exports OK');
    `;
      expect(
        execFileSync(runtime, ['--input-type=module', '-e', script], {
          cwd: process.cwd(),
          encoding: 'utf8',
          timeout: 10_000,
        }).trim(),
      ).toBe('runtime exports OK');
    },
  );
});
