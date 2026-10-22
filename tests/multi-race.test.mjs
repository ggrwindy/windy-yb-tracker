import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodePositions, normalizeYb, fetchYbRace, parseRaceCode, ybEndpoints } from '../src/yb.ts';
import { validateRace } from '../src/race.ts';

export function fixture(code) {
    const read = file => readFileSync(new URL(`./fixtures/${code}/${file}`, import.meta.url));
    const bytes = read('positions.bin');
    return { setup: JSON.parse(read('setup.json')), binary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), expected: JSON.parse(read('expected.json')) };
}

test('race codes and official links resolve only to fixed-host YB endpoints', async () => {
    for (const input of [' BALTICSEARACE2026 ', 'https://yb.tl/balticsearace2026', 'https://cf.yb.tl/balticsearace2026/', 'https://yb.tl/Simple/balticsearace2026?class=irc#map']) {
        assert.equal(parseRaceCode(input), 'balticsearace2026');
        assert.deepEqual(ybEndpoints(input), { setup: 'https://cf.yb.tl/JSON/balticsearace2026/RaceSetup', history: 'https://cf.yb.tl/BIN/balticsearace2026/AllPositions3' });
    }
    for (const input of ['', '../ggr2026', 'https://example.com/ggr2026', 'http://yb.tl/ggr2026', 'https://yb.tl@evil.example/ggr2026', 'https://user:pass@yb.tl/ggr2026', 'https://yb.tl:9999/ggr2026', 'https://yb.tl/JSON/ggr2026/RaceSetup', 'x'.repeat(81)]) {
        assert.throws(() => parseRaceCode(input));
        await assert.rejects(fetchYbRace(input, undefined, () => assert.fail('Invalid input must not fetch')));
    }
});

for (const [code, teamCount, fixCount] of [['balticsearace2026', 24, 24298], ['paccup2026', 49, 39981]]) {
    test(`${code}: all teams and fixes decode, and latest coordinates match YB Simple independently`, async () => {
        const data = fixture(code);
        const requests = [];
        const race = validateRace(await fetchYbRace(code, undefined, async (url, options) => {
            requests.push({ url, options });
            return { ok: true, json: async () => data.setup, arrayBuffer: async () => data.binary };
        }), code);
        assert.equal(race.title, data.setup.title);
        assert.equal(race.competitors.length, teamCount);
        assert.equal(race.reference_boats.length, 0);
        assert.equal(race.competitors.reduce((n, boat) => n + boat.track.length, 0), fixCount);
        assert.equal(requests.length, 2);
        assert.ok(requests.every(({ options }) => options.mode === 'cors' && options.credentials === 'omit' && !options.headers));
        for (const expected of data.expected.latest_positions) {
            const boat = race.competitors.find(boat => boat.tracker_id === expected.tracker_id);
            assert.equal(boat?.name, expected.name);
            assert.ok(boat.latest_position);
            // Simple view rounds coordinates to 0.001 arcminute.
            assert.ok(Math.abs(boat.latest_position.latitude - expected.latitude) <= 0.00002, `${boat.name} latitude`);
            assert.ok(Math.abs(boat.latest_position.longitude - expected.longitude) <= 0.00002, `${boat.name} longitude`);
        }
        assert.throws(() => validateRace(race, 'different-race'), /Invalid YB race/);
    });
}

test('reference labels are explicit and metadata without classes remains valid', () => {
    const points = [{ timestamp: '2026-10-22T00:00:00Z', latitude: 0, longitude: 0 }];
    const tracks = new Map([[1, points], [2, points]]);
    const setup = { title: 'A different race', tags: [{ id: 1, name: 'Reference boats' }, { id: 2, name: 'IRC Previous Winners' }], teams: [{ id: 1, name: 'Reference', tags: [1] }, { id: 2, name: 'Real competitor', tags: [2] }] };
    const race = normalizeYb(setup, tracks, 'another2026');
    assert.equal(race.reference_boats.length, 1);
    assert.equal(race.competitors[0].name, 'Real competitor');
    assert.equal(normalizeYb({ title: 'No classes', teams: [{ id: 1, name: 'Boat' }] }, new Map([[1, points]]), 'no-classes').competitors.length, 1);
});


test('same-second latest fixes prefer newest wire record without dropping or reordering history', () => {
    const newest = { timestamp: '2026-10-22T00:00:00Z', latitude: 60.1693, longitude: 24.9628 };
    const older = { ...newest, latitude: 60.1692, longitude: 24.9627 };
    const setup = { title: 'Duplicate fixes', teams: [{ id: 1, name: 'Boat' }] };
    const race = normalizeYb(setup, new Map([[1, [newest, older]]]), 'duplicates');
    assert.deepEqual(race.competitors[0].latest_position, newest);
    assert.deepEqual(race.competitors[0].track, [newest, older]);
});
