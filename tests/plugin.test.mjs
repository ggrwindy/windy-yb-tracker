import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, binary, expected as race } from './fixtures.mjs';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

test('compiled plugin loads boats, filters tracks, refreshes safely and removes every map layer on close', async () => {
    const entrantCount = race.competitors.filter(boat => boat.latest_position).length;
    const totalCount = entrantCount + race.reference_boats.filter(boat => boat.latest_position).length;
    const sample = race.competitors.find(boat => boat.latest_position);
    const activeFleet = race.competitors.filter(boat => boat.latest_position && boat.status !== 'RETIRED');
    const fleetPoints = boats => boats.map(boat => [boat.latest_position.latitude, boat.latest_position.longitude]);
    const dom = new JSDOM('<main></main>', { url: 'https://www.windy.com' });
    const keys = ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Element', 'CustomEvent'];
    const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
    const layers = new Set();
    const map = { fitBoundsCalls: [], panToCalls: [], removeLayer(layer) { layers.delete(layer); },
        fitBounds(points) { this.fitBoundsCalls.push(points); }, panTo(point) { this.panToCalls.push(point); } };
    class Layer {
        constructor(points, options) { this.points = points; this.options = options; }
        addTo() { layers.add(this); return this; }
        on(type, handler) { (this.handlers ??= {})[type] = handler; return this; }
    }
    class Polyline extends Layer {}
    class Marker extends Layer {}
    const openPopups = new Set();
    class Popup {
        open = false;
        element = document.createElement('div');
        setLatLng() { return this; } setContent(html) { this.html = html; return this; }
        openOn() { this.open = true; openPopups.add(this); document.body.append(this.element); return this; }
        getElement() { return this.element; }
        isOpen() { return this.open; }
        remove() {
            // Match Windy's strict behavior for already closed/detached popups.
            if (!this.open) throw new Error('This layer is not in a map.');
            this.open = false; openPopups.delete(this); this.element.remove();
        }
    }
    globalThis.L = { Marker, Polyline, Popup, divIcon: options => options };
    globalThis.W = { map: { map } };
    const originalFetch = globalThis.fetch;
    const datasets = new Map([['ggr2026', { setup, binary }]]);
    for (const code of ['balticsearace2026', 'paccup2026']) {
        const read = name => readFileSync(new URL(`./fixtures/${code}/${name}`, import.meta.url));
        const b = read('positions.bin');
        datasets.set(code, { setup: JSON.parse(read('setup.json')), binary: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });
    }
    let slowResolvers = [];
    let slowSignals = [];
    localStorage.setItem('ggr2026-tracker-v1', 'original-plugin-settings');
    let fail = false;
    let fetches = 0;
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let tick;
    let timerCleared = false;
    globalThis.setInterval = callback => { tick = callback; return 42; };
    globalThis.clearInterval = id => { if (id === 42) timerCleared = true; };
    const urls = [];
    globalThis.fetch = async (url, options) => {
        fetches++;
        urls.push(url);
        if (fail) throw new Error('Test server unavailable');
        const code = new URL(url).pathname.split('/')[2];
        if (code === 'slow2026') {
            slowSignals.push(options.signal);
            await new Promise(resolve => slowResolvers.push(resolve)); // Deliberately ignores cancellation.
        }
        const data = datasets.get(code === 'slow2026' ? 'ggr2026' : code);
        if (!data) return { ok: false, status: 503 };
        if (url.includes('/JSON/')) return { ok: true, json: async () => structuredClone(data.setup) };
        if (url.includes('/BIN/')) return { ok: true, arrayBuffer: async () => data.binary.slice(0) };
        assert.fail('Unexpected data URL: ' + url);
    };
    const settle = () => new Promise(resolve => setImmediate(resolve));
    const click = element => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    const change = element => element.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    let app;
    try {
        const { default: Plugin, __pluginConfig } = await import('../dist/plugin.js');
        assert.equal(__pluginConfig.private, true);
        assert.equal(__pluginConfig.author, 'GGR tracker');
        app = new Plugin({ target: document.querySelector('main') });
        await settle();
        assert.equal(fetches, 2);
        assert.ok(urls.every(url => url.startsWith('https://cf.yb.tl/')));
        assert.match(document.body.textContent, /Updated/);
        assert.doesNotMatch(document.body.textContent, /Data source|Custom JSON|Connect/i);
        assert.equal(document.querySelectorAll('select').length, 1);
        assert.equal(document.querySelectorAll('form').length, 1);
        assert.equal([...layers].filter(l => l instanceof Marker).length, entrantCount);
        assert.equal(map.fitBoundsCalls.length, 1);
        assert.deepEqual(map.fitBoundsCalls.at(-1), fleetPoints(activeFleet), 'initial fit excludes retired competitors');
        assert.ok(document.body.textContent.includes(`${entrantCount} teams on map`));

        const favorite = race.competitors.find(boat => boat.tracker_id !== sample.tracker_id && boat.latest_position);
        const favoriteButton = () => [...document.querySelectorAll('.favorite-toggle')].find(button => button.getAttribute('aria-label') === `Favorite ${favorite.name}`);
        const favoriteMarker = () => [...layers].find(layer => layer instanceof Marker && layer.options.icon.html.includes(`title="${favorite.name}"`));
        click(favoriteButton()); await settle();
        assert.equal(document.querySelector('.boat .boat-name').textContent, favorite.name, 'favorites move above non-favorites');
        assert.equal(favoriteButton().getAttribute('aria-pressed'), 'true');
        assert.deepEqual(favoriteMarker().options.icon.iconSize, [38, 38]);
        assert.equal(favoriteMarker().options.zIndexOffset, 10000);
        assert.equal([...layers].at(-1), favoriteMarker(), 'favorite paths and markers are drawn last');
        assert.ok([...layers].some(layer => layer instanceof Polyline && layer.options.weight === 4 && layer.options.opacity === 1));
        assert.equal(map.panToCalls.length, 0, 'favoriting does not change map focus');
        click(favoriteButton()); await settle();
        assert.equal(document.querySelector('.boat .boat-name').textContent, sample.name, 'unfavoriting restores source order');
        assert.deepEqual(favoriteMarker().options.icon.iconSize, [28, 28]);
        assert.equal(favoriteMarker().options.zIndexOffset, 0);
        click(favoriteButton()); await settle();

        const trackSelect = document.querySelector('select');
        trackSelect.value = 'none'; change(trackSelect); await settle();
        assert.equal([...layers].filter(l => l instanceof Polyline).length, 0);
        assert.equal([...layers].filter(l => l instanceof Marker).length, entrantCount);

        const reference = [...document.querySelectorAll('label')].find(label => label.textContent.includes('Reference boats')).querySelector('input');
        reference.checked = true; change(reference); await settle();
        assert.equal([...layers].filter(l => l instanceof Marker).length, totalCount);
        const fitFleet = [...document.querySelectorAll('button')].find(button => button.textContent === 'Fit fleet');
        click(fitFleet); await settle();
        assert.deepEqual(map.fitBoundsCalls.at(-1), fleetPoints(activeFleet), 'visible reference boats do not change fleet bounds');

        const skipper = [...document.querySelectorAll('input[type=checkbox]')].find(input => input.getAttribute('aria-label') === `Show ${sample.name}`);
        skipper.checked = false; change(skipper); await settle();
        assert.equal([...layers].filter(l => l instanceof Marker).length, totalCount - 1);
        click(fitFleet); await settle();
        assert.deepEqual(map.fitBoundsCalls.at(-1), fleetPoints(activeFleet.filter(boat => boat.tracker_id !== sample.tracker_id)), 'hidden active boats are excluded');
        click(skipper.closest('.boat').querySelector('button')); await settle();
        assert.equal([...layers].filter(l => l instanceof Marker).length, totalCount);
        assert.deepEqual(map.panToCalls.at(-1), [sample.latest_position.latitude, sample.latest_position.longitude]);
        assert.ok(document.querySelector('.details').textContent.includes(sample.latest_position.timestamp.replace('T', ' ').slice(0, 19) + ' UTC'));

        assert.equal(openPopups.size, 1);
        click([...openPopups][0].getElement()); await settle();
        assert.equal(openPopups.size, 1, 'clicking inside the popup leaves it open');
        const outside = document.createElement('div');
        outside.addEventListener('click', event => event.stopPropagation()); // Windy's weather picker.
        document.body.append(outside);
        click(outside); await settle();
        assert.equal(openPopups.size, 0, 'outside clicks close the popup even when a map control consumes the event');
        click(skipper.closest('.boat').querySelector('.boat-info')); await settle();
        assert.equal(openPopups.size, 1, 'a popup reopens after outside dismissal');
        [...openPopups][0].remove(); // User clicks the popup's close button.
        click(favoriteButton().closest('.boat').querySelector('.boat-info')); await settle();
        assert.equal(openPopups.size, 1, 'another skipper opens after closing the previous popup');
        assert.ok([...openPopups][0].html.includes(favorite.name));
        [...openPopups][0].remove();
        favoriteMarker().handlers.click(); await settle();
        assert.equal(openPopups.size, 1, 'the same skipper reopens from its map marker');
        assert.ok([...openPopups][0].html.includes(favorite.name));
        click(skipper.closest('.boat').querySelector('.boat-info')); await settle();
        assert.equal(openPopups.size, 1, 'switching directly replaces the open popup');
        assert.ok([...openPopups][0].html.includes(sample.name));
        click(outside); await settle();
        assert.equal(openPopups.size, 0, 'repeated outside dismissal also works');
        outside.remove();

        click([...document.querySelectorAll('button')].find(button => button.textContent === 'None')); await settle();
        const fitCount = map.fitBoundsCalls.length;
        click(fitFleet); await settle();
        assert.equal(map.fitBoundsCalls.length, fitCount, 'an empty fleet leaves the map bounds unchanged');
        click([...document.querySelectorAll('button')].find(button => button.textContent === 'All')); await settle();

        for (let minute = 0; minute < 10; minute++) tick();
        await settle();
        assert.equal(fetches, 4, 'automatic refresh runs every ten minutes');
        const auto = document.querySelector('.auto input');
        auto.checked = false; change(auto); await settle();
        for (let minute = 0; minute < 10; minute++) tick();
        await settle();
        assert.equal(fetches, 4, 'automatic refresh can be disabled');

        fail = true;
        click([...document.querySelectorAll('button')].find(button => button.textContent === 'Refresh'));
        await settle();
        assert.equal(fetches, 6);
        assert.match(document.querySelector('[role="alert"]').textContent, /Showing the last successful load/);
        assert.equal([...layers].filter(l => l instanceof Marker).length, totalCount);
        assert.ok(localStorage.getItem('yb-race-tracker-v1:ggr2026'));
        const saved = JSON.parse(localStorage.getItem('yb-race-tracker-v1:ggr2026'));
        assert.equal(saved.endpoint, undefined);
        assert.equal(saved.dataSource, undefined);
        assert.equal(saved.favorites[favorite.tracker_id], true);
        assert.ok(urls.every(url => url.startsWith('https://cf.yb.tl/')));
        app.$destroy(); app = null;
        assert.equal(layers.size, 0);
        assert.equal(openPopups.size, 0);
        assert.equal(document.querySelector('main').children.length, 0);
        assert.equal(timerCleared, true);
        fail = false;
        app = new Plugin({ target: document.querySelector('main') });
        await settle();
        assert.equal(document.querySelector('.boat .boat-name').textContent, favorite.name, 'favorites survive reopening');
        assert.equal(favoriteButton().getAttribute('aria-pressed'), 'true');
        assert.deepEqual(favoriteMarker().options.icon.iconSize, [38, 38]);
        const loadRace = async value => {
            const input = document.querySelector('#yb-race-input');
            input.value = value;
            input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
            document.querySelector('.race-picker').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
            await settle();
        };
        await loadRace('balticsearace2026');
        assert.equal(document.querySelector('h2').textContent, 'RORC Baltic Sea Race 2026');
        assert.equal([...layers].filter(l => l instanceof Marker).length, 23);
        assert.ok([...document.querySelectorAll('.favorite-toggle')].every(b => b.getAttribute('aria-pressed') === 'false'), 'favorites never leak across races with overlapping IDs');
        assert.equal(document.querySelector('.auto input').checked, true);
        const balticFavorite = document.querySelector('.favorite-toggle');
        click(balticFavorite); await settle();
        const balticName = document.querySelector('.boat .boat-name').textContent;
        document.querySelector('select').value = '24'; change(document.querySelector('select')); await settle();
        const balticSetup = datasets.get('balticsearace2026').setup;
        assert.equal(map.fitBoundsCalls.at(-1).length, balticSetup.teams.filter(t => t.status !== 'RETIRED').length, 'new-race fit excludes retired teams');
        await loadRace('https://yb.tl/paccup2026');
        assert.equal(document.querySelector('h2').textContent, 'Pacific Cup');
        assert.equal([...layers].filter(l => l instanceof Marker).length, 49);
        assert.ok([...document.querySelectorAll('.favorite-toggle')].every(b => b.getAttribute('aria-pressed') === 'false'));
        await loadRace('ggr2026');
        assert.equal(favoriteButton().getAttribute('aria-pressed'), 'true');
        assert.equal(document.querySelector('select').value, 'none');
        assert.equal(document.querySelector('.auto input').checked, false);
        assert.equal([...layers].filter(l => l instanceof Marker).length, totalCount);
        await loadRace('missing2026');
        assert.match(document.querySelector('[role=alert]').textContent, /missing2026.*HTTP 503.*Showing the last successful load/);
        assert.equal(document.querySelector('h2').textContent, setup.title);
        assert.equal([...layers].filter(l => l instanceof Marker).length, totalCount);
        assert.equal(localStorage.getItem('yb-race-tracker:last-race'), 'ggr2026', 'failed selection does not replace saved race');
        const beforeInvalid = fetches;
        await loadRace('https://evil.example/race');
        assert.equal(fetches, beforeInvalid, 'invalid host causes no request');
        await loadRace('slow2026');
        assert.equal(slowResolvers.length, 2);
        await loadRace('balticsearace2026');
        assert.ok(slowSignals.every(signal => signal.aborted));
        slowResolvers.forEach(resolve => resolve()); slowResolvers = []; await settle(); await settle();
        assert.equal(document.querySelector('h2').textContent, 'RORC Baltic Sea Race 2026', 'late superseded response cannot overwrite active race');
        assert.equal(document.querySelector('.boat .boat-name').textContent, balticName);
        assert.equal(document.querySelector('select').value, '24');
        assert.equal(localStorage.getItem('ggr2026-tracker-v1'), 'original-plugin-settings', 'the GGR-only plugin keeps its own preferences');
        await loadRace('slow2026');
        const duringPending = fetches;
        for (let minute = 0; minute < 10; minute++) tick();
        await settle();
        assert.equal(fetches, duringPending, 'auto refresh does not cancel an in-progress race selection');
        app.$destroy(); app = null;
        assert.equal(layers.size, 0);
        slowResolvers.forEach(resolve => resolve()); slowResolvers = []; await settle(); await settle();
        assert.equal(document.querySelector('main').children.length, 0, 'late response cannot revive a closed plugin');
        app = new Plugin({ target: document.querySelector('main') }); await settle();
        assert.equal(document.querySelector('h2').textContent, 'RORC Baltic Sea Race 2026', 'last successful race survives reopening');
        assert.equal(document.querySelector('.boat .boat-name').textContent, balticName);
        app.$destroy(); app = null;
        assert.equal(layers.size, 0);
    } finally {
        app?.$destroy();
        globalThis.fetch = originalFetch;
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
        delete globalThis.W; delete globalThis.L;
        for (const key of keys) {
            const original = originals.get(key);
            if (original) Object.defineProperty(globalThis, key, original);
            else delete globalThis[key];
        }
        dom.window.close();
    }
});
