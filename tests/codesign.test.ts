import { describe, expect, it } from 'vitest';
import { codeFromUrl, incomingWins, partKey, randomCode } from '../src/app/codesign.js';

describe('co-design', () => {
  it('settles simultaneous edits the same way on both sides', () => {
    // Host (rank 0) and guest (rank 1) both send clock 3 at once.
    const hostTakesGuest = incomingWins(3, 0, 3, 1);
    const guestTakesHost = incomingWins(3, 1, 3, 0);
    // Exactly one side gives way, so both end on the host's part.
    expect(hostTakesGuest).toBe(false);
    expect(guestTakesHost).toBe(true);
    // A later edit always wins.
    expect(incomingWins(3, 0, 4, 1)).toBe(true);
    expect(incomingWins(5, 1, 4, 0)).toBe(false);
  });

  it('keys a part independently of parameter order', () => {
    const a = partKey({ job: 'cradle', material: 'pla', params: { w: 80, d: 45 } });
    const b = partKey({ job: 'cradle', material: 'pla', params: { d: 45, w: 80 } });
    expect(a).toBe(b);
    expect(partKey({ job: 'cradle', material: 'pla', params: { d: 45, w: 80.5 } })).not.toBe(a);
  });

  it('reads join links and makes six-digit codes', () => {
    expect(codeFromUrl('?room=123456')).toBe('123456');
    expect(codeFromUrl('?x=1&room=987654')).toBe('987654');
    expect(codeFromUrl('?room=12345')).toBeNull();
    for (let i = 0; i < 50; i++) expect(randomCode()).toMatch(/^\d{6}$/u);
  });
});
