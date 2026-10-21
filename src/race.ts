export interface Position {
    timestamp: string;
    latitude: number;
    longitude: number;
    altitude_m?: number;
}

export interface Boat {
    tracker_id: string;
    name: string;
    boat_name: string | null;
    status: string;
    color?: string;
    classes: string[];
    latest_position: Position | null;
    track: Position[];
}

export interface Race {
    schema_version: number;
    race: string;
    fetched_at: string;
    competitors: Boat[];
    reference_boats: Boat[];
}

export function validateRace(value: unknown): Race {
    const data = value as Race;
    const validPoint = (p: Position) => p && Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90 &&
        Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180 && Number.isFinite(Date.parse(p.timestamp));
    if (!data || data.schema_version !== 1 || data.race !== 'ggr2026' ||
        !Number.isFinite(Date.parse(data.fetched_at)) || !Array.isArray(data.competitors) ||
        !Array.isArray(data.reference_boats) || !data.competitors.length) {
        throw new Error('Invalid GGR 2026 race data.');
    }
    const ids = new Set<string>();
    for (const boat of [...data.competitors, ...data.reference_boats]) {
        if (!boat || typeof boat.tracker_id !== 'string' || ids.has(boat.tracker_id) ||
            typeof boat.name !== 'string' || !Array.isArray(boat.track) ||
            !boat.track.every(validPoint) || (boat.latest_position !== null && !validPoint(boat.latest_position))) {
            throw new Error('Invalid competitor or track in race data.');
        }
        ids.add(boat.tracker_id);
    }
    return data;
}

export function colorFor(boat: Boat): string {
    if (boat.color && /^#[0-9a-f]{6}$/i.test(boat.color)) return boat.color;
    let hash = 0;
    for (const char of boat.tracker_id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return `hsl(${hash * 137.508 % 360}, 80%, 60%)`;
}

export function ageLabel(timestamp: string, now = Date.now()): string {
    const hours = Math.max(0, (now - Date.parse(timestamp)) / 3600000);
    if (hours < 1) return `${Math.floor(hours * 60)}m ago`;
    if (hours < 48) return `${Math.floor(hours)}h ${Math.floor(hours % 1 * 60)}m ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

export function utcLabel(timestamp: string): string {
    return new Date(timestamp).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

export function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;',
        '"': '&quot;', "'": '&#39;' })[char]!);
}

export function navigation(boat: Boat): { bearing: number; speed: number; hours: number } | null {
    const end = boat.latest_position;
    if (!end) return null;
    const start = [...boat.track].reverse().find(p => p.timestamp < end.timestamp &&
        (p.latitude !== end.latitude || p.longitude !== end.longitude));
    if (!start) return null;
    const radians = (degrees: number) => degrees * Math.PI / 180;
    const lat1 = radians(start.latitude), lat2 = radians(end.latitude);
    const dLat = lat2 - lat1, dLon = radians(end.longitude - start.longitude);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const distanceNM = 3440.065 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
    const hours = (Date.parse(end.timestamp) - Date.parse(start.timestamp)) / 3600000;
    const bearing = (Math.atan2(Math.sin(dLon) * Math.cos(lat2),
        Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)) * 180 / Math.PI + 360) % 360;
    return { bearing, speed: distanceNM / hours, hours };
}

export function splitTrack(points: Position[]): [number, number][][] {
    if (!points.length) return [];
    const segments: [number, number][][] = [[[points[0].latitude, points[0].longitude]]];
    for (const point of points.slice(1)) {
        const end: [number, number] = [point.latitude, point.longitude];
        const segment = segments[segments.length - 1];
        const start = segment[segment.length - 1];
        const difference = end[1] - start[1];
        if (Math.abs(difference) > 180) {
            const adjusted = end[1] - (difference > 180 ? 360 : -360);
            const boundary = difference > 180 ? -180 : 180;
            const latitude = start[0] + (boundary - start[1]) / (adjusted - start[1]) * (end[0] - start[0]);
            segment.push([latitude, boundary]);
            segments.push([[latitude, -boundary], end]);
        } else segment.push(end);
    }
    return segments.filter(segment => segment.length >= 2);
}
