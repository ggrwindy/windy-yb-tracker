import { readFileSync } from 'node:fs';
import { decodePositions, normalizeYb } from '../src/yb.ts';

const read = name => readFileSync(new URL('./fixtures/' + name, import.meta.url));
const bytes = read('positions.bin');
export const binary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
export const setup = JSON.parse(read('setup.json'));
export const expected = JSON.parse(read('expected.json'));
export const raceFixture = () => normalizeYb(setup, decodePositions(binary), 'ggr2026');
