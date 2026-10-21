import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, binary, expected as race } from './fixtures.mjs';
import { JSDOM } from 'jsdom';

test('compiled plugin loads boats, filters tracks, refreshes safely and removes every map layer on close', async () => {
    const entrantCount = race.competitors.filter(boat => boat.latest_position).length;
    const totalCount = entrantCount + race.reference_boats.filter(boat => boat.latest_position).length;
    const sample = race.competitors.find(boat => boat.latest_position);
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
    let fail = false;
    let fetches = 0;
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let tick;
    let timerCleared = false;
    globalThis.setInterval = callback => { tick = callback; return 42; };
    globalThis.clearInterval = id => { if (id === 42) timerCleared = true; };
    const urls = [];
    globalThis.fetch = async url => {
        fetches++;
        urls.push(url);
        if (fail) throw new Error('Test server unavailable');
        if (url.includes('/JSON/')) return { ok: true, json: async () => structuredClone(setup) };
        if (url.includes('/BIN/')) return { ok: true, arrayBuffer: async () => binary.slice(0) };
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
        assert.doesNotMatch(document.body.textContent, /YB|Data source|Custom JSON|Connect/i);
        assert.equal(document.querySelectorAll('select').length, 1);
        assert.equal(document.querySelectorAll('a, form, input[type=url]').length, 0);
        assert.equal([...layers].filter(l => l instanceof Marker).length, entrantCount);
        assert.equal(map.fitBoundsCalls.length, 1);
        assert.ok(document.body.textContent.includes(`${entrantCount} boats on map`));

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

        const skipper = [...document.querySelectorAll('input[type=checkbox]')].find(input => input.getAttribute('aria-label') === `Show ${sample.name}`);
        skipper.checked = false; change(skipper); await settle();
        assert.equal([...layers].filter(l => l instanceof Marker).length, totalCount - 1);
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
        assert.ok(localStorage.getItem('ggr2026-tracker-v1'));
        const saved = JSON.parse(localStorage.getItem('ggr2026-tracker-v1'));
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
