import { describe, expect, test } from 'bun:test';

import { personPage } from './person-page.ts';

const GOLDEN = `---
type: person
title: Éloïse Dûpont
description: Head of Retail @ Maison Lumière
emails:
  - eloise.dupont@maison-lumiere.com
  - edupont@maison-lumiere.onmicrosoft.com
org: /orgs/maison-lumiere.md
department: Retail
tags:
  - seed
timestamp: 2026-07-04
---

# Éloïse Dûpont

## Commitments

_None recorded yet._
`;

describe('person page', () => {
  test('a colleague becomes an OKF person page with a kebab slug', () => {
    const page = personPage(
      {
        displayName: 'Éloïse Dûpont',
        emails: ['eloise.dupont@maison-lumiere.com', 'edupont@maison-lumiere.onmicrosoft.com'],
        title: 'Head of Retail',
        company: 'Maison Lumière',
        department: 'Retail',
      },
      '2026-07-04'
    );

    expect(page.path).toBe('data/kb/people/eloise-dupont.md');
    expect(page.content).toBe(GOLDEN);
  });

  test('a contact with no title or company still gets a valid page', () => {
    const page = personPage({ displayName: 'John Doe', emails: ['john@ext.com'] }, '2026-07-04');

    expect(page.path).toBe('data/kb/people/john-doe.md');
    expect(page.content).toContain('description: Contact seeded from the directory');
    expect(page.content).not.toContain('org:');
    expect(page.content).not.toContain('department:');
  });
});
