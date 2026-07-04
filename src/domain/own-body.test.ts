import { describe, expect, test } from 'bun:test';

import { extractOwnBody, extractSignature } from './own-body.ts';

const SAMPLE = `**Subject:** RE: Budget Q3
**From:** Vincent DELACOURT
**To:** Jane Boss
**Date:** 2026-07-03

Hello Jane,

Confirmed for Ledger, we align with the group choice. I will push the QUICK OB step with Sam next week and come back to you with the planning.

Vincent

**_Vincent DELACOURT_**

_Chief Information Officer_

![](cid:image001.png@01DC)

**From:** Jane Boss <jane@internal-corp.com>
**Sent:** Thursday, July 2, 2026

Hi Vincent, can you confirm the T&E choice?
`;

const OWN = `Hello Jane,

Confirmed for Ledger, we align with the group choice. I will push the QUICK OB step with Sam next week and come back to you with the planning.

Vincent`;

describe('own-body extraction', () => {
  test("the user's own words survive; the quoted chain and signature do not", () => {
    expect(extractOwnBody(SAMPLE, 'Vincent DELACOURT', 'Chief Information Officer')).toBe(OWN);
  });

  test('French, English, and Chinese reply intros all cut the chain', () => {
    const base = 'Merci pour le point, on avance comme prévu.';
    const CUTS = [
      'Le 27 février 2026 à 10:02, Jane a écrit :',
      'Le 7 mai 2026, Jean a écrit :',
      'Le  27 février 2026, double espace',
      'On Tue, May 20, 2026 at 9:00 AM Jane wrote:',
      '发件人: Jane Boss',
      '发件人： Jane Boss',
      '寄件者: Jane Boss',
      '寄件者： Jane Boss',
      '-----Original Message-----',
      '> Le 27 mai 2026, Jane a écrit :',
      '* * *',
      '  *  *  * ',
      '---',
      '--------',
      '**From:** Jane Boss',
      '**From :** Jane Boss',
      'From: Jane Boss',
      'From : Jane Boss',
      '**De:** Jean Chef',
      '**De :** Jean Chef',
      'De: Jean Chef',
      'De : Jean Chef',
    ];
    for (const cut of CUTS) {
      expect(extractOwnBody(`${base}\n${cut}\nold quoted text`)).toBe(base);
    }

    const KEEPS = [
      'from: my side, all good on the numbers front',
      'de: notre côté rien à signaler',
      'Le planning est validé pour 2026',
      'Le 27 est validé',
      'Le 27 xyz 20 court',
      'Xe 27 février 2026 pas un intro',
      'Le vingt février 2026 pas un intro',
      'Le 27 février 206 an trop court',
      'From: 123 rue de la Paix as text',
      'From:',
      'On the topic of budget, agreed',
      'On Tuesday we meet Jane at 9',
      'On Tue May 20 2026 no commas here',
      'On Tue, May 20, 26 short year',
      'On Tue, May 20, 20266 five digit year',
      'On Tue, May 2a26 tricky not a year',
      'Le 27 février :::: faux an',
      '_Stryker was here!_ as literal text',
      'Once upon 2026, a story',
      'PS: -----Original Message----- is a phrase I quote',
      '- one dash bullet',
      '--',
      '* single star line *',
      '**__**',
    ];
    for (const keep of KEEPS) {
      expect(extractOwnBody(`${base}\n${keep}`)).toBe(`${base}\n${keep}`);
    }
    expect(extractOwnBody(`${base}\n**_Stryker was here!_**\ntail stays`)).toBe(`${base}\n**_Stryker was here!_**\ntail stays`);

    expect(extractOwnBody(`${base}\n  **_Vincent DELACOURT_**\nsig`, 'Vincent DELACOURT')).toBe(base);
    expect(extractOwnBody(`${base}\n_Chief Information Officer_\nsig`, '', 'Chief Information Officer')).toBe(base);
  });

  test('a bare reply with no signature or chain passes through intact', () => {
    const bare = '**Subject:** ping\n\nYes, works for me. Let us lock Tuesday 9am and invite the finance team as discussed.';

    expect(extractOwnBody(bare, 'Vincent DELACOURT')).toBe('Yes, works for me. Let us lock Tuesday 9am and invite the finance team as discussed.');

    const HEADERS = [
      '**Subject:** x',
      'Subject: x',
      '  Subject: leading spaces',
      'From: x',
      'To: x',
      'Cc: x',
      'Bcc: x',
      'Date: x',
      'Sent: x',
      'Importance: High',
      '**Importance :** High',
    ];
    for (const header of HEADERS) {
      expect(extractOwnBody(`${header}\n\nBody line stays here`)).toBe('Body line stays here');
    }
    expect(extractOwnBody('Random: not a header\nBody')).toBe('Random: not a header\nBody');
    expect(extractOwnBody('No colon header line\nBody')).toBe('No colon header line\nBody');
    expect(extractOwnBody('From: x\n \nTo: y')).toBe('');
    expect(extractOwnBody('From: x\n \nTo: y\n\nReal body')).toBe('Real body');

    const artifacts = 'Before table\n<table border="1">\n<tr><td>sig</td></tr>\n</table>\nAfter ![](cid:image9.png) image\n\n\n\nEnd';
    expect(extractOwnBody(artifacts)).toBe('Before table\nAfter  image\n\nEnd');
    expect(extractOwnBody('Keep\n  <table x="1">\ninside\n</table>\nTail')).toBe('Keep\nTail');
    expect(extractOwnBody('truncated ![](cid:unclosed')).toBe('truncated');
    expect(extractOwnBody('First line\n  indented list item stays indented\nLast')).toBe('First line\n  indented list item stays indented\nLast');
  });

  test('the signature block extracts clean of markup', () => {
    expect(extractSignature(SAMPLE, 'Vincent DELACOURT', 'Chief Information Officer')).toBe('Vincent DELACOURT\nChief Information Officer');
    expect(extractSignature(SAMPLE)).toBe('');
    expect(extractSignature('Body only, no marker anywhere', 'Vincent DELACOURT')).toBe('');

    const rich = [
      'Own text first',
      '**_Vincent DELACOURT_**',
      '_Chief Information Officer_',
      '__Acme Retail__',
      ' _Paris_ ',
      'trailing spaces here   ',
      '[book a slot](https://cal.example) <span>x</span>',
      '_',
      '_x',
      'x_',
      'a_b',
      '**From:** Jane quoted',
    ].join('\n');
    expect(extractSignature(rich, 'Vincent DELACOURT', 'Chief Information Officer')).toBe(
      'Vincent DELACOURT\nChief Information Officer\nAcme Retail\nParis\ntrailing spaces here\nbook a slot (https://cal.example) x\n_\n_x\nx_\na_b'
    );
    expect(extractOwnBody(rich, 'Vincent DELACOURT', 'Chief Information Officer')).toBe('Own text first');
    expect(extractSignature('Own text\n  **_Vincent DELACOURT_**\n_CIO_', 'Vincent DELACOURT')).toBe('Vincent DELACOURT\nCIO');
  });
});
