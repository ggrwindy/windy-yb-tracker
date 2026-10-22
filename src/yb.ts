import type { Boat, Position, Race } from './race';

export const DEFAULT_RACE = 'ggr2026';
export const EXAMPLE_RACES = [
    { code: 'ggr2026', title: 'Golden Globe Race 2026' },
    { code: 'balticsearace2026', title: 'RORC Baltic Sea Race 2026' },
    { code: 'paccup2026', title: 'Pacific Cup' },
];

/** Accept public YB race links or codes; fetch only from the fixed YB host. */
export function parseRaceCode(input: string): string {
    let code = input.trim();
    if (/^https?:\/\//i.test(code)) {
        const url = new URL(code);
        if (url.protocol !== 'https:' || !['yb.tl', 'www.yb.tl', 'cf.yb.tl'].includes(url.hostname) ||
            url.username || url.password || url.port) throw new Error('Use an HTTPS yb.tl race link or a race code.');
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length === 2 && /^(simple|leaderboard|links)$/i.test(parts[0])) parts.shift();
        if (parts.length !== 1) throw new Error('Use a YB race link such as https://yb.tl/ggr2026.');
        code = parts[0];
    }
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(code)) throw new Error('Enter a valid YB race code or HTTPS yb.tl race link.');
    return code.toLowerCase();
}

export function ybEndpoints(input: string) {
    const code = parseRaceCode(input);
    return { setup: `https://cf.yb.tl/JSON/${code}/RaceSetup`, history: `https://cf.yb.tl/BIN/${code}/AllPositions3` };
}

interface Team {
    id: number;
    name: string;
    owner?: string;
    status?: string;
    colour?: string;
    tags?: number[];
}

interface Setup {
    title: string;
    teams: Team[];
    tags?: { id: number; name: string }[];
}

/** Decode the public tracker's big-endian absolute and backward-delta fixes. */
export function decodePositions(data: ArrayBuffer): Map<number, Position[]> {
    const view = new DataView(data);
    let offset = 0;
    function read(bytes: number, signed = false): number {
        if (offset + bytes > view.byteLength) throw new Error(`Truncated track positions at byte ${offset}.`);
        const at = offset;
        offset += bytes;
        if (bytes === 1) return view.getUint8(at);
        if (bytes === 2) return signed ? view.getInt16(at) : view.getUint16(at);
        return signed ? view.getInt32(at) : view.getUint32(at);
    }
    const flags = read(1), epoch = read(4);
    if (flags & ~15) throw new Error(`Unsupported track positions flags: ${flags}.`);
    const teams = new Map<number, Position[]>();
    while (offset < view.byteLength) {
        const id = read(2), count = read(2);
        if (teams.has(id)) throw new Error(`Duplicate tracker team ID ${id}.`);
        let previous: { at: number; lat: number; lon: number } | null = null;
        const points: Position[] = [];
        for (let i = 0; i < count; i++) {
            if (offset >= view.byteLength) throw new Error('Missing track position record.');
            const delta = !!(view.getUint8(offset) & 128);
            let at: number, lat: number, lon: number;
            if (delta) {
                if (!previous) throw new Error('Track delta has no preceding absolute position.');
                at = previous.at - (read(2) & 32767);
                lat = previous.lat + read(2, true);
                lon = previous.lon + read(2, true);
            } else {
                at = epoch + read(4); lat = read(4, true); lon = read(4, true);
            }
            const altitude = flags & 1 ? read(2, true) : undefined;
            if (flags & 2) { read(delta ? 2 : 4, true); if (flags & 4) read(1); }
            if (flags & 8) read(delta ? 2 : 4, true);
            previous = { at, lat, lon };
            if (Math.abs(lat) > 9000000 || Math.abs(lon) > 18000000) throw new Error(`Invalid track coordinate for team ${id}.`);
            const point: Position = { timestamp: new Date(at * 1000).toISOString().replace('.000Z', 'Z'),
                latitude: lat / 100000, longitude: lon / 100000 };
            if (altitude !== undefined) point.altitude_m = altitude;
            points.push(point);
        }
        // Preserve distinct and repeated fixes, including fixes sharing one GPS second.
        teams.set(id, points.sort((a, b) => a.timestamp.localeCompare(b.timestamp)));
    }
    return teams;
}

export function normalizeYb(value: unknown, positions: Map<number, Position[]>, raceCode: string): Race {
    const code = parseRaceCode(raceCode);
    const setup = value as Setup;
    if (!setup || typeof setup.title !== 'string' || !setup.title.trim() || !Array.isArray(setup.teams) || (setup.tags !== undefined && !Array.isArray(setup.tags))) {
        throw new Error('Invalid race metadata.');
    }
    const tags = new Map((setup.tags || []).map(tag => [tag.id, tag.name]));
    const ids = new Set<number>();
    const competitors: Boat[] = [], references: Boat[] = [];
    for (const team of setup.teams) {
        if (!Number.isInteger(team.id) || typeof team.name !== 'string' || ids.has(team.id)) throw new Error('Invalid or duplicate tracker team.');
        ids.add(team.id);
        const classes = (team.tags || []).map(id => {
            const name = tags.get(id);
            if (typeof name !== 'string') throw new Error(`Unknown tracker class ${id}.`);
            return name;
        });
        const track = positions.get(team.id) || [];
        // Equal-time fixes retain newest-first wire order. Prefer the first of
        // the newest timestamp group, matching YB's independently rendered Simple view.
        const latest = track.find(point => point.timestamp === track.at(-1)?.timestamp) || null;
        const boat: Boat = { tracker_id: String(team.id), name: team.name, boat_name: team.owner ?? null,
            status: team.status ?? '', classes, latest_position: latest, track };
        if (team.colour && /^[a-f0-9]{6}$/i.test(team.colour)) boat.color = '#' + team.colour;
        (classes.some(name => /^(previous competitors|reference(?: boats)?|ghost(?: boats)?|historical(?: competitors| boats)?)$/i.test(name.trim())) ? references : competitors).push(boat);
    }
    if ([...positions.keys()].some(id => !ids.has(id))) throw new Error('track positions contain unknown teams.');
    if (!competitors.some(boat => boat.latest_position)) throw new Error('The tracker returned no current competitor positions.');
    return { schema_version: 1, race: code, title: setup.title.trim(), fetched_at: new Date().toISOString(),
        competitors, reference_boats: references };
}

export async function fetchYbRace(input: string, signal?: AbortSignal, request: typeof fetch = fetch): Promise<Race> {
    const code = parseRaceCode(input), endpoints = ybEndpoints(code);
    // Plain CORS GETs: no credentials, API keys, custom headers, proxy, or own server.
    const options: RequestInit = { signal, mode: 'cors', credentials: 'omit' };
    const responses = await Promise.all([
        request(endpoints.setup, options), request(endpoints.history, options),
    ]);
    for (let i = 0; i < responses.length; i++) {
        if (!responses[i].ok) throw new Error(`Tracker ${i === 0 ? 'metadata' : 'history'} returned HTTP ${responses[i].status}.`);
    }
    const [setup, binary] = await Promise.all([responses[0].json(), responses[1].arrayBuffer()]);
    return normalizeYb(setup, decodePositions(binary), code);
}
