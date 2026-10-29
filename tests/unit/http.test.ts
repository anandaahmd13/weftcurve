import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { handle } from '../../src/server/http';

describe('English API errors', () => {
  it.each([
    ['Sign in required.', 401],
    ['Origin is not allowed.', 403],
    ['Invalid CSRF token.', 403],
    ['Too many requests. Please try again shortly.', 429],
    ['Insufficient balance.', 400],
  ])('preserves status for %s', async (message, status) => {
    const response = await handle(async () => { throw new Error(message); });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: message });
  });

  it('returns a readable English validation message', async () => {
    const response = await handle(async () => z.string().parse(123));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid input. Please check the form.' });
  });

  it('does not expose database details', async () => {
    const response = await handle(async () => {
      throw Object.assign(new Error('private database details'), { code: 'ECONNREFUSED' });
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Database unavailable or operation failed. Start the database and run migrations.' });
  });
});
