import { describe, expect, it } from 'vitest';

import { isAllowedBridgeOrigin } from '@/lib/security/bridgeOrigin';

describe('isAllowedBridgeOrigin', () => {
  it('allows the trusted host and its subdomains over https', () => {
    expect(isAllowedBridgeOrigin('https://holobots.fun/arena')).toBe(true);
    expect(isAllowedBridgeOrigin('https://app.holobots.fun/')).toBe(true);
    expect(isAllowedBridgeOrigin('https://holobots.fun')).toBe(true);
  });

  it('rejects non-https schemes', () => {
    expect(isAllowedBridgeOrigin('http://holobots.fun/')).toBe(false);
    expect(isAllowedBridgeOrigin('javascript:alert(1)')).toBe(false);
    expect(isAllowedBridgeOrigin('file:///etc/passwd')).toBe(false);
  });

  it('rejects look-alike and third-party hosts (token exfiltration guard)', () => {
    expect(isAllowedBridgeOrigin('https://holobots.fun.evil.com/')).toBe(false);
    expect(isAllowedBridgeOrigin('https://evil-holobots.fun.attacker.test/')).toBe(false);
    expect(isAllowedBridgeOrigin('https://attacker.test/holobots.fun')).toBe(false);
    expect(isAllowedBridgeOrigin('https://notholobots.fun/')).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(isAllowedBridgeOrigin('')).toBe(false);
    expect(isAllowedBridgeOrigin('not a url')).toBe(false);
    expect(isAllowedBridgeOrigin('holobots.fun')).toBe(false);
  });
});
