import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setup, binary as buffer, expected } from './fixtures.mjs';
import { decodePositions, normalizeYb, fetchYbRace, YB_ENDPOINTS } from '../src/yb.ts';

test('every real tracker fix and boat matches the reference fixture', () => {
    const actual = normalizeYb(setup, decodePositions(buffer));
    const summarize = ({ track, ...boat }) => ({ ...boat, track_length: track.length,
        track_sha256: createHash('sha256').update(JSON.stringify(track)).digest('hex') });
    assert.deepEqual(actual.competitors.map(summarize), expected.competitors);
    assert.deepEqual(actual.reference_boats.map(summarize), expected.reference_boats);
    assert.equal(actual.competitors.length, 16);
    assert.equal(actual.reference_boats.length, 4);
    assert.equal(actual.competitors.reduce((n, boat) => n + boat.track.length, 0), 17236);
});

function wire(flags, records, count = 1) {
    const head = Buffer.alloc(9);
    head.writeUInt8(flags); head.writeUInt32BE(1700000000, 1);
    head.writeUInt16BE(42, 5); head.writeUInt16BE(count, 7);
    return Uint8Array.from(Buffer.concat([head, ...records])).buffer;
}
function absolute(lat = -1700000, lon = 3100000) {
    const point = Buffer.alloc(12);
    point.writeUInt32BE(10000); point.writeInt32BE(lat, 4); point.writeInt32BE(lon, 8);
    return point;
}

test('binary optional fields, backward deltas and same-second fixes are preserved', () => {
    const extras = Buffer.from('000c000001f40101406f40', 'hex'); // altitude, distance, lap, progress
    const delta = Buffer.alloc(13);
    delta.writeUInt16BE(0x8000 | 14400); delta.writeInt16BE(100, 2); delta.writeInt16BE(-200, 4);
    delta.writeInt16BE(13, 6); delta.writeInt16BE(-50, 8); delta.writeUInt8(1, 10); delta.writeInt16BE(-100, 11);
    const points = decodePositions(wire(15, [absolute(), extras, delta], 2)).get(42);
    assert.deepEqual(points, [
        { timestamp: '2023-11-14T21:00:00Z', latitude: -16.999, longitude: 30.998, altitude_m: 13 },
        { timestamp: '2023-11-15T01:00:00Z', latitude: -17, longitude: 31, altitude_m: 12 },
    ]);
    assert.equal(decodePositions(wire(0, [absolute(), absolute(-1699999)], 2)).get(42).length, 2);
});

test('truncated, unknown, duplicate and invalid binary records fail clearly', () => {
    const valid = wire(0, [absolute()]);
    for (const end of [0, 1, 4, 6, 8, 10, valid.byteLength - 1]) assert.throws(() => decodePositions(valid.slice(0, end)));
    assert.throws(() => decodePositions(wire(16, [absolute()])), /flags/);
    assert.throws(() => decodePositions(wire(0, [Buffer.from('800100000000', 'hex')])), /preceding absolute/);
    assert.throws(() => decodePositions(wire(0, [absolute(9100000)])), /coordinate/);
    assert.throws(() => decodePositions(wire(0, [absolute(), Buffer.from('002a0000', 'hex')])), /Duplicate/);
    assert.throws(() => normalizeYb(setup, new Map([[9999, []]])), /unknown teams/);
});

test('direct acquisition uses only two credential-free CORS GETs and propagates errors', async () => {
    const controller = new AbortController();
    const calls = [];
    const request = async (url, options) => {
        calls.push([url, options]);
        return { ok: true, json: async () => setup, arrayBuffer: async () => buffer };
    };
    const race = await fetchYbRace(controller.signal, request);
    assert.equal(race.competitors.length, 16);
    assert.deepEqual(calls.map(([url]) => url), Object.values(YB_ENDPOINTS));
    for (const [, options] of calls) assert.deepEqual(options, { signal: controller.signal, mode: 'cors', credentials: 'omit' });
    await assert.rejects(fetchYbRace(undefined, async () => ({ ok: false, status: 503 })), /HTTP 503/);
    controller.abort();
    await assert.rejects(fetchYbRace(controller.signal, async (_, options) => {
        options.signal.throwIfAborted();
    }), { name: 'AbortError' });
});
