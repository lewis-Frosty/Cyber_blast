import { describe, expect, it } from 'vitest';
import { MAX_KEEP_RUN_IDS, sanitiseKeepRunIds } from '../src/backend/keepRunIds';

const UUID = '11111111-2222-4333-8444-555555555555';

describe('keepRunIds sanitiser', () => {
  it('keeps well-formed uuids', () => {
    expect(sanitiseKeepRunIds([UUID])).toEqual([UUID]);
  });

  it('refuses anything that could break out of the PostgREST filter', () => {
    // These are interpolated into `in.("a","b")`. A quote or a bracket that
    // survived would change which rows the update touches.
    const hostile = [
      `${UUID}")--`,
      '") or true --',
      `"${UUID}"`,
      `${UUID},${UUID}`,
      `${UUID})`,
      'not-a-uuid',
      '',
    ];
    expect(sanitiseKeepRunIds(hostile)).toEqual([]);
  });

  it('drops non-strings and non-arrays rather than throwing', () => {
    expect(sanitiseKeepRunIds([1, null, undefined, {}, [UUID]])).toEqual([]);
    expect(sanitiseKeepRunIds(null)).toEqual([]);
    expect(sanitiseKeepRunIds('not an array')).toEqual([]);
    expect(sanitiseKeepRunIds(undefined)).toEqual([]);
  });

  it('caps the list, so a client cannot pin unbounded runs as active', () => {
    const many = Array.from({ length: 50 }, () => UUID);
    expect(sanitiseKeepRunIds(many)).toHaveLength(MAX_KEEP_RUN_IDS);
  });
});
