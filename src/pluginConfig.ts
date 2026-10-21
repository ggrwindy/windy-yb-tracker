import type { ExternalPluginConfig } from '@windy/interfaces';

const config: ExternalPluginConfig = {
    name: 'windy-plugin-ggr2026',
    version: '0.3.5',
    icon: '⛵',
    title: 'Golden Globe Race 2026',
    description: 'Competitor positions and historical tracks over Windy weather maps.',
    author: 'GGR tracker',
    repository: 'https://github.com/ggrwindy/windyggr',
    homepage: 'https://github.com/ggrwindy/windyggr#readme',
    desktopUI: 'embedded',
    mobileUI: 'small',
    routerPath: '/ggr2026',
    private: false,
};

export default config;
