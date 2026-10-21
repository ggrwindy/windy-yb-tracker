import type { ExternalPluginConfig } from '@windy/interfaces';

const config: ExternalPluginConfig = {
    name: 'windy-plugin-ggr2026',
    version: '0.3.3',
    icon: '⛵',
    title: 'Golden Globe Race 2026',
    description: 'Competitor positions and historical tracks over Windy weather maps.',
    author: 'GGR tracker',
    desktopUI: 'embedded',
    mobileUI: 'small',
    routerPath: '/ggr2026',
    private: true,
};

export default config;
