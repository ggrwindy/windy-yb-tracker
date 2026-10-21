import test from 'node:test';
import assert from 'node:assert/strict';
import { raceFixture } from './fixtures.mjs';
import { validateRace, splitTrack, navigation, ageLabel, escapeHtml, colorFor } from '../src/race.ts';

test('validates real tracker data and rejects broken data', () => {
    const race = raceFixture();
    assert.ok(validateRace(race).competitors.length > 0);
    assert.throws(() => validateRace({ ...race, schema_version: 99 }));
    const broken = structuredClone(race);
    broken.competitors[0].track[0].latitude = 100;
    assert.throws(() => validateRace(broken));
});

test('tracks cross the dateline without spanning the world', () => {
    const points = [
        { latitude: 0, longitude: 179, timestamp: '2026-10-21T00:00:00Z' },
        { latitude: 2, longitude: -179, timestamp: '2026-10-21T04:00:00Z' },
    ];
    assert.deepEqual(splitTrack(points), [[[0, 179], [1, 180]], [[1, -180], [2, -179]]]);
});

test('navigation uses elapsed GPS time and handles duplicate timestamps', () => {
    const track = [
        { latitude: 0, longitude: 0, timestamp: '2026-10-21T00:00:00Z' },
        { latitude: 0, longitude: 1, timestamp: '2026-10-21T04:00:00Z' },
        { latitude: 0, longitude: 1, timestamp: '2026-10-21T04:00:00Z' },
    ];
    const result = navigation({ track, latest_position: track.at(-1) });
    assert.equal(result.hours, 4);
    assert.equal(result.bearing, 90);
    assert.ok(Math.abs(result.speed - 15.01) < 0.01);
});

test('upstream strings cannot become popup or icon markup', () => {
    assert.equal(escapeHtml('<img title="x">&'), '&lt;img title=&quot;x&quot;&gt;&amp;');
    assert.equal(colorFor({ tracker_id: '1', color: '#FF3300' }), '#FF3300');
    assert.match(colorFor({ tracker_id: '1', color: 'red;transform:scale(100)' }), /^hsl\(/);
    assert.equal(ageLabel('2026-10-21T00:00:00Z', Date.parse('2026-10-21T04:00:00Z')), '4h 0m ago');
});
