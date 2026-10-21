declare const L: typeof import('@windycom/plugin-devtools/types/leaflet-gl');

declare namespace L {
    type Layer = import('@windycom/plugin-devtools/types/leaflet-gl').Layer;
    type Popup = import('@windycom/plugin-devtools/types/leaflet-gl').Popup;
}
