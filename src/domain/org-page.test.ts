import { describe, expect, test } from 'bun:test';

import { orgPage } from './org-page.ts';

const GOLDEN = `---
type: organization
title: Adama Development
description: Internal organization
domains:
  - adama-development.com
relationship: internal
tags:
  - seed
timestamp: 2026-07-04
---

# Adama Development

## Key people

_None linked yet._
`;

describe('org page', () => {
  test('organizations derive from email domains, own domain marked internal', () => {
    const internal = orgPage({ name: 'Adama Development', domains: ['adama-development.com'], internal: true }, '2026-07-04');
    const external = orgPage({ name: 'Maison Lumière', domains: ['maison-lumiere.com'], internal: false }, '2026-07-04');

    expect(internal.path).toBe('data/kb/orgs/adama-development.md');
    expect(internal.content).toBe(GOLDEN);
    expect(external.path).toBe('data/kb/orgs/maison-lumiere.md');
    expect(external.content).toContain('relationship: external');
    expect(external.content).toContain('description: External organization');
  });
});
