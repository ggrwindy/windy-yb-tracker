# GGR 2026 Windy plugin

Competitor positions and historical tracks over Windy weather maps. The plugin fetches directly from the public tracker; no backend or database is required.

## Local development

Requires Node.js 22.18 or later.

```sh
npm ci
npm start
```

Open [Windy developer mode](https://www.windy.com/developer-mode), enter `http://localhost:9999/plugin.js`, press Tab, then select **Install & open plugin**. Review Windy's developer terms yourself if prompted.

The development server binds to `127.0.0.1:9999` and serves only the built plugin files. Keep it running when loading the local plugin. Stop it with Ctrl+C.

```sh
npm run dev    # rebuild on changes; reload the plugin in Windy
npm run check  # Svelte and TypeScript checks
npm run build  # build dist/plugin.js, plugin.min.js and plugin.json
npm test       # run the offline regression tests after building
```

## Controls

- Star a skipper to move them to the top and emphasize their boat and track.
- Toggle boats individually, search, or use All/None and Fit fleet.
- Choose full tracks, seven days, 24 hours, or tracks off.
- Enable reference boats to show previous-race tracks.
- Click a boat or skipper for GPS coordinates, time and average navigation details. Click outside the popup to dismiss it.
- Refresh manually or enable automatic refresh every ten minutes. It defaults to on; browser preferences are saved.
- Collapse the tracker with **−** or close it with **×**.

Weather follows Windy's forecast timeline. Boats show their latest GPS fix, usually published every four hours. Favorites, visibility and display settings stay in browser local storage.

## Data and distribution

`src/yb.ts` reads race metadata and binary position history from `https://cf.yb.tl` using credential-free HTTPS requests. The tracker controls history availability. Failed requests retain the last successful load until the page is reloaded.

Tests use a fixed public tracker capture in `tests/fixtures/`, including expected metadata and track checksums. They run without network access.

The self-contained JavaScript bundles include the plugin styles. Publish through [Windy's plugin hosting workflow](https://docs.windy-plugins.com/getting-started/publishing-plugin.html) for distribution. Configuration lives in `src/pluginConfig.ts` and defaults to private distribution.

## Deploy to Windy

Deployment uploads the static bundle to Windy with `private: true`. Anyone with the installation URL can use it, without contacting a server of ours. Gallery submission is separate.

### One-time setup

Publishing requires Git and `tar`.

1. Sign into [Windy API keys](https://api.windy.com/keys) using the separate developer account. Create a **Windy Plugins API** key; Map Forecast keys do not publish plugins.
2. Use the release repository [ggrwindy/windyggr](https://github.com/ggrwindy/windyggr), authenticated as `ggrwindy`. Commit and push this source, then create a release matching the version in `src/pluginConfig.ts` and `package.json`.
3. Copy `.windy-publish.env.example` to `.windy-publish.env`. Fill in `WINDY_API_KEY` and the repository HTTPS URL in `WINDY_REPOSITORY`. This local file is ignored by Git; keep it out of chat and source control.

### Publish a release

Update both version fields for subsequent releases, commit and push the changes, and create the matching GitHub release. Windy requires each upload to have a new version.

```sh
npm ci
npm run deploy:prepare  # checks, builds, tests, and creates dist/plugin.tar without uploading
npm run deploy         # repeats validation, uploads to Windy, and verifies the hosted bundle
```

The uploader uses the actual Git commit and repository metadata. It requires a clean working tree and packages only the three plugin files, with neutral archive ownership. It sends the API key only to Windy's official upload endpoint; the key is never embedded in the bundle.

The command prints the hosted installation URL and saves a receipt in `dist/publish-result.json`. Install that hosted URL in Windy and confirm positions, tracks and favorites still work after a full reload with the local development server stopped.

See [Windy's official publishing guide](https://docs.windy-plugins.com/getting-started/publishing-plugin.html) for account setup and gallery review.
