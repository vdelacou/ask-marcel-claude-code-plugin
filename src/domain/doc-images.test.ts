import { describe, expect, test } from 'bun:test';

import { extractDocImages, flattenDocImagePath } from './doc-images.ts';

describe('doc-images', () => {
  test('extractDocImages pulls the path and base64 of every media entry', () => {
    const data = {
      count: 2,
      media: [
        { path: 'ppt/media/image1.png', contentType: 'image/png', sizeBytes: 10, base64: 'iVBORw0KGgo=' },
        { path: 'word/media/image2.jpg', contentType: 'image/jpeg', sizeBytes: 20, base64: '/9j/4AAQ' },
      ],
    };

    expect(extractDocImages(data)).toEqual([
      { path: 'ppt/media/image1.png', base64: 'iVBORw0KGgo=' },
      { path: 'word/media/image2.jpg', base64: '/9j/4AAQ' },
    ]);
  });

  test('extractDocImages drops entries missing a path or a base64, and any non-record', () => {
    const data = {
      count: 5,
      media: [{ path: 'a/img.png', base64: 'aaaa' }, { path: 'b/img.png' }, { base64: 'bbbb' }, 'not-a-record', null],
    };

    // toStrictEqual (not toEqual) so a dropped isDocImage filter, which would leave undefined holes, is caught
    expect(extractDocImages(data)).toStrictEqual([{ path: 'a/img.png', base64: 'aaaa' }]);
  });

  test('extractDocImages returns nothing for a non-record, a missing media key, or a non-array media', () => {
    expect(extractDocImages(undefined)).toEqual([]);
    expect(extractDocImages({ count: 0 })).toEqual([]);
    expect(extractDocImages({ media: 'nope' })).toEqual([]);
  });

  test('flattenDocImagePath folds the source part path to a single filesystem-safe leaf', () => {
    expect(flattenDocImagePath('ppt/media/image3.png')).toBe('ppt_media_image3.png');
  });

  test('flattenDocImagePath neutralizes a directory-traversal path', () => {
    expect(flattenDocImagePath('../../etc/passwd')).toBe('.._.._etc_passwd');
  });
});
