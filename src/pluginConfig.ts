import type { ExternalPluginConfig } from '@windy/interfaces';

const config: ExternalPluginConfig = {
    name: 'windy-plugin-yb-tracker',
    version: '0.1.0',
    icon: '⛵',
    title: 'YB Race Tracker (experimental)',
    description: 'Choose a public YB race and view its teams and historical tracks over Windy weather maps.',
    author: 'GGR tracker',
    repository: 'https://github.com/ggrwindy/windy-yb-tracker',
    homepage: 'https://github.com/ggrwindy/windy-yb-tracker#readme',
    desktopUI: 'embedded',
    mobileUI: 'small',
    routerPath: '/yb-race-tracker',
    private: true,
};

export default config;
