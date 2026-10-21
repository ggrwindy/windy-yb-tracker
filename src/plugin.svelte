<section class="ggr-panel" aria-label="Golden Globe Race tracker">
    <header>
        <div><span class="eyebrow">GOLDEN GLOBE RACE</span><h2>Alone around the world <span>2026</span></h2></div>
        <button class="collapse" on:click={() => collapsed = !collapsed} aria-label={collapsed ? 'Expand tracker' : 'Collapse tracker'}>{collapsed ? '+' : '−'}</button>
    </header>
    {#if !collapsed}
        <div class="toolbar">
            <button on:click={fitFleet} disabled={!race}>Fit fleet</button>
            <button on:click={() => refresh()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
            <label class="auto" class:checked={autoRefresh}><input type="checkbox" bind:checked={autoRefresh} /> Auto Refresh (10min)</label>
        </div>
        {#if error}<p class="error" role="alert">{error}{race ? ' Showing the last successful load.' : ''}</p>{/if}
        {#if race}
            <div class="summary">
                <span><b>{visibleBoats.length}</b> boats on map</span>
                <span class:warning={now - Date.parse(race.fetched_at) > 1800000}>Updated {ageLabel(race.fetched_at, now)}</span>
            </div>
            <div class="filters">
                <label>Tracks <select bind:value={trackWindow}><option value="all">Full history</option><option value="168">Last 7 days</option><option value="24">Last 24 hours</option><option value="none">Off</option></select></label>
                <label><input type="checkbox" bind:checked={showReferences} /> Reference boats</label>
            </div>
            <p class="hint">GPS fixes usually arrive every 4 hours. Weather follows Windy's forecast time; boats show their latest GPS fix.</p>
            <div class="search-row"><input type="text" aria-label="Search competitors" placeholder="Find a skipper or boat" bind:value={search} /><button on:click={() => setAll(true)}>All</button><button on:click={() => setAll(false)}>None</button></div>
            <div class="boats">
                {#each listedBoats as boat (boat.tracker_id)}
                    <div class:selected={selectedId === boat.tracker_id} class:favorite={favorites[boat.tracker_id] === true} class="boat" style:--boat-color={colorFor(boat)}>
                        <input type="checkbox" aria-label={'Show ' + boat.name} checked={enabled[boat.tracker_id] !== false} on:change={(event) => toggleBoat(boat.tracker_id, event.currentTarget.checked)} />
                        <button class="boat-info" on:click={() => focusBoat(boat)} disabled={!boat.latest_position}>
                            <span class="boat-name">{boat.name}</span><span class="boat-meta">{boat.boat_name || 'Historical reference'}{boat.status === 'RETIRED' ? ' · retired' : ''}</span>
                        </button>
                        <button class="favorite-toggle" class:checked={favorites[boat.tracker_id] === true} aria-label={'Favorite ' + boat.name} aria-pressed={favorites[boat.tracker_id] === true} title={favorites[boat.tracker_id] ? 'Remove from favorites' : 'Add to favorites'} on:click={() => toggleFavorite(boat.tracker_id)}>{favorites[boat.tracker_id] ? '★' : '☆'}</button>
                        <span class="age" class:warning={boat.latest_position && now - Date.parse(boat.latest_position.timestamp) > 28800000}>{boat.latest_position ? ageLabel(boat.latest_position.timestamp, now) : 'No fix'}</span>
                    </div>
                {/each}
            </div>
            {#if selectedBoat && selectedBoat.latest_position}
                <div class="details">
                    <strong>{selectedBoat.name}</strong><span>{utcLabel(selectedBoat.latest_position.timestamp)}</span>
                    <span>{selectedBoat.latest_position.latitude.toFixed(5)}°, {selectedBoat.latest_position.longitude.toFixed(5)}°</span>
                    {#if selectedNavigation}<span>Average {selectedNavigation.speed.toFixed(1)} kn · course {Math.round(selectedNavigation.bearing)}° over {selectedNavigation.hours.toFixed(1)}h</span>{/if}
                </div>
            {/if}
        {:else if !error}<p class="hint">Loading competitor positions and historical tracks…</p>{/if}
    {/if}
</section>

<script lang="ts">
    import { map } from '@windy/map';
    import { onMount, onDestroy } from 'svelte';
    import { fetchYbRace } from './yb';
    import { validateRace, colorFor, ageLabel, utcLabel, escapeHtml, navigation, splitTrack } from './race';
    import type { Boat, Race } from './race';

    const storageKey = 'ggr2026-tracker-v1';
    let race: Race | null = null;
    let enabled: Record<string, boolean> = {};
    let favorites: Record<string, boolean> = {};
    let selectedId = '';
    let search = '';
    let trackWindow = '168';
    let showReferences = false;
    let autoRefresh = true;
    let collapsed = false;
    let loading = false;
    let error = '';
    let now = Date.now();
    let active = false;
    let ready = false;
    let firstFit = true;
    let request: AbortController | null = null;
    let interval: ReturnType<typeof setInterval>;
    let layers: L.Layer[] = [];
    let popup: L.Popup | null = null;
    let selectedBoat: Boat | undefined;
    let selectedNavigation: ReturnType<typeof navigation>;
    let allBoats: Boat[] = [];
    let visibleBoats: Boat[] = [];
    let listedBoats: Boat[] = [];

    $: allBoats = race ? [...race.competitors, ...(showReferences ? race.reference_boats : [])] : [];
    $: visibleBoats = allBoats.filter(boat => enabled[boat.tracker_id] !== false && boat.latest_position);
    $: listedBoats = allBoats.filter(boat => `${boat.name} ${boat.boat_name || ''}`.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => Number(favorites[b.tracker_id] === true) - Number(favorites[a.tracker_id] === true));
    $: selectedBoat = allBoats.find(boat => boat.tracker_id === selectedId);
    $: selectedNavigation = selectedBoat ? navigation(selectedBoat) : null;
    $: if (ready) draw(visibleBoats, trackWindow, selectedId, favorites);
    $: if (ready) savePreferences(enabled, trackWindow, showReferences, autoRefresh, favorites);

    function savePreferences(boats: Record<string, boolean>, tracks: string, references: boolean, auto: boolean, starred: Record<string, boolean>) {
        try { localStorage.setItem(storageKey, JSON.stringify({ enabled: boats, trackWindow: tracks, showReferences: references, autoRefresh: auto, favorites: starred })); } catch { /* Storage can be disabled. */ }
    }

    function clearPopup() {
        const current = popup;
        popup = null;
        // Windy's map throws if remove() is called after the user closed it.
        if (current?.isOpen()) current.remove();
    }

    function dismissPopupOutside(event: MouseEvent) {
        if (popup?.isOpen() && !event.composedPath().includes(popup.getElement())) clearPopup();
    }

    function clearLayers() {
        clearPopup();
        for (const layer of layers) map.removeLayer(layer);
        layers = [];
    }

    function draw(boats: Boat[], windowHours: string, focusId: string, starred: Record<string, boolean>) {
        clearLayers();
        // Draw favorites last so their paths sit above the other fleet paths.
        const drawOrder = [...boats].sort((a, b) => Number(starred[a.tracker_id] === true) - Number(starred[b.tracker_id] === true));
        for (const boat of drawOrder) {
            const position = boat.latest_position!;
            const color = colorFor(boat);
            const favorite = starred[boat.tracker_id] === true;
            if (windowHours !== 'none') {
                const cutoff = windowHours === 'all' ? -Infinity : Date.parse(position.timestamp) - Number(windowHours) * 3600000;
                for (const segment of splitTrack(boat.track.filter(point => Date.parse(point.timestamp) >= cutoff))) {
                    const line = new L.Polyline(segment, { color, weight: (favorite ? 4 : 2) + (boat.tracker_id === focusId ? 2 : 0), opacity: favorite ? 1 : 0.8 }).addTo(map);
                    layers.push(line);
                }
            }
            const nav = navigation(boat);
            const name = escapeHtml(boat.name);
            const size = favorite ? 38 : 28;
            const icon = L.divIcon({ className: favorite ? 'ggr-marker ggr-favorite-marker' : 'ggr-marker', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
                html: `<div title="${name}" style="width:${size}px;height:${size}px;filter:drop-shadow(0 ${favorite ? '2px 4px' : '1px 2px'} #000)"><svg viewBox="0 0 28 28" style="width:${size}px;height:${size}px;transform:rotate(${nav?.bearing || 0}deg)"><path d="M14 2 Q24 17 20 25 L8 25 Q4 17 14 2Z" fill="${color}" stroke="white" stroke-width="${favorite ? 2.4 : 1.6}"/><path d="M14 8V20" stroke="#122634" stroke-width="1.8"/></svg></div>` });
            const marker = new L.Marker([position.latitude, position.longitude], { icon, zIndexOffset: favorite ? 10000 : 0 }).addTo(map);
            marker.on('click', () => focusBoat(boat));
            layers.push(marker);
        }
    }

    function toggleBoat(id: string, checked: boolean) {
        enabled = { ...enabled, [id]: checked };
        if (!checked && selectedId === id) selectedId = '';
    }

    function toggleFavorite(id: string) {
        favorites = { ...favorites, [id]: favorites[id] !== true };
    }

    function setAll(value: boolean) {
        enabled = { ...enabled, ...Object.fromEntries(allBoats.map(boat => [boat.tracker_id, value])) };
        if (!value) selectedId = '';
    }

    function fitFleet() {
        const points: [number, number][] = visibleBoats.map(boat => [boat.latest_position!.latitude, boat.latest_position!.longitude]);
        if (points.length) map.fitBounds(points, { padding: [55, 55], maxZoom: 7 });
    }

    function focusBoat(boat: Boat) {
        if (!boat.latest_position) return;
        enabled = { ...enabled, [boat.tracker_id]: true };
        selectedId = boat.tracker_id;
        const p = boat.latest_position;
        map.panTo([p.latitude, p.longitude]);
        // Wait for Svelte's redraw before opening a popup, so cleanup cannot remove it.
        queueMicrotask(() => {
            if (!active) return;
            const nav = navigation(boat);
            const html = `<div style="min-width:210px;line-height:1.6"><strong>${escapeHtml(boat.name)}</strong><br>${escapeHtml(boat.boat_name || 'Historical reference')}<br>${utcLabel(p.timestamp)}<br>${p.latitude.toFixed(5)}°, ${p.longitude.toFixed(5)}°${nav ? `<br>Average ${nav.speed.toFixed(1)} kn · ${Math.round(nav.bearing)}°` : ''}</div>`;
            clearPopup();
            popup = new L.Popup({ closeOnClick: true }).setLatLng([p.latitude, p.longitude]).setContent(html).openOn(map);
        });
    }

    async function refresh() {
        if (loading || !active) return;
        loading = true; error = '';
        request = new AbortController();
        const timeout = setTimeout(() => request?.abort(), 25000);
        try {
            const result = validateRace(await fetchYbRace(request.signal));
            if (!active) return;
            race = result;
            now = Date.now();
            if (firstFit) { firstFit = false; queueMicrotask(fitFleet); }
        } catch (reason) {
            if (active) error = reason instanceof Error && reason.name !== 'AbortError' ? reason.message : 'Data request timed out.';
        } finally {
            clearTimeout(timeout); request?.abort(); request = null; loading = false;
        }
    }

    export const onopen = () => { if (active && !race) void refresh(); };

    onMount(() => {
        active = true;
        // Capture before Windy's weather picker or map controls consume the click.
        document.addEventListener('click', dismissPopupOutside, true);
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
            enabled = saved.enabled || {};
            if (saved.favorites && typeof saved.favorites === 'object' && !Array.isArray(saved.favorites)) {
                favorites = Object.fromEntries(Object.entries(saved.favorites).filter(([, value]) => value === true).map(([id]) => [id, true]));
            }
            trackWindow = ['all', '168', '24', 'none'].includes(saved.trackWindow) ? saved.trackWindow : '168';
            showReferences = saved.showReferences === true;
            autoRefresh = saved.autoRefresh !== false;
        } catch { /* Use defaults if preferences are unavailable. */ }
        ready = true;
        void refresh();
        let ticks = 0;
        interval = setInterval(() => { now = Date.now(); if (++ticks % 10 === 0 && autoRefresh) void refresh(); }, 60000);
    });

    onDestroy(() => { active = false; ready = false; document.removeEventListener('click', dismissPopupOutside, true); clearInterval(interval); request?.abort(); clearLayers(); });
</script>

<style>
    :global(#plugin-windy-plugin-ggr2026) { width: 354px !important; height: auto !important; max-height: none !important; padding: 0 !important; margin-top: 40px !important; max-width: calc(100vw - 16px); }
    :global(#plugin-windy-plugin-ggr2026 > .closing-x) { top: 14px !important; right: 12px !important; width: 28px; height: 28px; margin: 0 !important; display: grid; place-items: center; border: 1px solid #597381; border-radius: 5px; background: #263e4c; color: #eaf0f2; }
    :global(#plugin-windy-plugin-ggr2026 > .closing-x::before) { content: '×'; font: 22px/1 system-ui, sans-serif; }
    :global(#plugin-windy-plugin-ggr2026 > .closing-x:hover) { background: #385768; }
    /* Leave room for Windy's weather menu and bottom controls in its flex column. */
    .ggr-panel { width: 100%; box-sizing: border-box; max-height: calc(100dvh - 350px); display: flex; flex-direction: column; color: #eaf0f2; font: 13px/1.45 system-ui, sans-serif; background: #132834f2; border: 1px solid #456170; border-radius: 12px; box-shadow: 0 8px 30px #0005; overflow-x: hidden; overflow-y: auto; }
    header, .toolbar, .summary, .filters, .hint, .search-row, .details, .error { flex-shrink: 0; }
    header { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 14px 52px 10px 14px; border-bottom: 1px solid #3b5260; }
    h2 { margin: 3px 0 0; font-size: 14px; font-weight: 600; line-height: 1.4; } h2 span { color: #efbd69; margin-left: 5px; }
    .eyebrow { letter-spacing: 2px; font-size: 9px; color: #b1cbd8; font-weight: 650; }
    button, input, select { font: inherit; } button { cursor: pointer; border: 1px solid #597381; background: #263e4c; color: #eaf0f2; border-radius: 5px; padding: 5px 8px; } button:hover { background: #385768; } button:disabled { opacity: .55; cursor: default; } button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #f2c783; outline-offset: 2px; }
    .collapse { flex-shrink: 0; font-size: 22px; line-height: 1; border: 0; background: transparent; }
    .toolbar { display: flex; align-items: center; gap: 6px; padding: 10px 12px 6px; }
    .auto { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; padding: 5px 8px; border: 1px solid #597381; border-radius: 5px; background: #263e4c; color: #eaf0f2; cursor: pointer; white-space: nowrap; }
    .auto:hover { background: #385768; }
    .auto.checked { background: #f2c783; border-color: #f2c783; color: #132834; box-shadow: inset 0 1px 2px #0003; }
    .auto.checked:hover { background: #ffd69a; border-color: #ffd69a; }
    .auto.checked input { accent-color: #132834; }
    .auto input { margin: 0; }
    input[type=checkbox] { accent-color: #f2c783; width: 14px; height: 14px; cursor: pointer; vertical-align: middle; }
    .summary { display: flex; justify-content: space-between; padding: 4px 14px; color: #b4cbd5; font-size: 11px; } .summary b { color: #f2c783; }
    .filters { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 8px 12px 0; font-size: 11px; }
    select { background: #263e4c; color: #eaf0f2; border: 1px solid #597381; border-radius: 4px; padding: 4px; max-width: 117px; }
    .hint { font-size: 11px; color: #b1c5cf; padding: 0 14px; margin: 8px 0; }
    .search-row { display: flex; gap: 5px; padding: 0 12px 8px; } .search-row input { width: 100%; min-width: 50px; } input[type=text] { padding: 6px 8px; background: #0e202b; color: #edf3f6; border: 1px solid #4d6776; border-radius: 5px; } input::placeholder { color: #91aab8; font-size: 11px; }
    .boats { min-height: 40px; flex: 1 1 auto; max-height: min(32vh, 290px); overflow-y: auto; scrollbar-width: thin; scrollbar-color: #6d8795 #162d3b; }
    .boat { display: flex; gap: 7px; align-items: center; border-left: 3px solid var(--boat-color); padding: 6px 12px 6px 8px; margin: 0 12px 3px; background: #203744; border-radius: 0 4px 4px 0; } .boat.selected { background: #385665; }
    .boat-info { flex: 1; min-width: 0; border: 0; padding: 0; text-align: left; background: transparent; } .boat-info:hover { color: #f2c783; } .boat-name, .boat-meta { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .boat-name { font-size: 12px; font-weight: 600; } .boat-meta { font-size: 10px; color: #b1c5cf; } .age { font-size: 10px; color: #c1d0d8; white-space: nowrap; } .warning { color: #f2c783; }
    .favorite-toggle { flex-shrink: 0; width: 25px; padding: 1px; border-color: transparent; background: transparent; color: #91aab8; font-size: 20px; line-height: 24px; }
    .favorite-toggle:hover, .favorite-toggle.checked { color: #f2c783; }
    .boat.favorite .boat-name { color: #f2c783; font-weight: 700; }
    .details { display: grid; gap: 3px; padding: 9px 14px; border-top: 1px solid #456170; font-size: 11px; } .details strong { color: #f2c783; }
    .error { padding: 8px 14px; color: #ffd0be; background: #693c34; margin: 8px 12px; border-radius: 4px; font-size: 11px; }
    @media (max-width: 600px) { :global(#plugin-windy-plugin-ggr2026) { width: calc(100vw - 24px) !important; margin-top: 0 !important; } .ggr-panel { max-height: 65dvh; } .boats { max-height: 20vh; } header { padding-top: 8px; padding-bottom: 6px; } .hint { display: none; } }
</style>
