# GGR 2026 Windy plugin

Competitor positions and historical tracks over Windy weather maps. The plugin fetches directly from the public tracker; no backend or database is required.

This project was built using AI, with OpenAI Codex used for implementation, testing, and documentation.

## Install the published plugin

Gallery review is pending. Until Windy approves the listing, install the published public release directly:

1. Open [Windy Plugins](https://www.windy.com/plugins).
2. Choose **Load plugin directly from URL**.
3. Paste this URL and choose **Install untrusted plugin**:

   ```text
   https://windy-plugins.com/18061010/windy-plugin-ggr2026/0.3.5/plugin.min.js
   ```

4. Open **Golden Globe Race 2026** from Windy's menu, or use [the installed tracker link](https://www.windy.com/plugin/ggr2026).

After approval, find **Golden Globe Race 2026** in [Windy’s plugin gallery](https://www.windy.com/plugins) and choose Install. Windy hosts the plugin; no local server is needed. Source and the release archive are available in [GitHub release v0.3.5](https://github.com/ggrwindy/windyggr/releases/tag/v0.3.5).

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
- Toggle boats individually, search, or use All/None. Fit fleet frames selected competitors, excluding reference and retired boats.
- Choose full tracks, seven days, 24 hours, or tracks off.
- Enable reference boats to show previous-race tracks.
- Click a boat or skipper for GPS coordinates, time and average navigation details. Click outside the popup to dismiss it.
- Refresh manually or enable automatic refresh every ten minutes. It defaults to on; browser preferences are saved.
- Collapse the tracker with **−** or close it with **×**.

Weather follows Windy's forecast timeline. Boats show their latest GPS fix, usually published every four hours. Favorites, visibility and display settings stay in browser local storage.

## Data and distribution

`src/yb.ts` reads race metadata and binary position history from `https://cf.yb.tl` using credential-free HTTPS requests. The tracker controls history availability. Failed requests retain the last successful load until the page is reloaded.

Tests use a fixed public tracker capture in `tests/fixtures/`, including expected metadata and track checksums. They run without network access.

The self-contained JavaScript bundles include the plugin styles. Publish through [Windy's plugin hosting workflow](https://docs.windy-plugins.com/getting-started/publishing-plugin.html) for distribution. Configuration lives in `src/pluginConfig.ts` and enables public distribution with `private: false`. The gallery image is `src/screenshot.jpg`.

## Deploy to Windy

Deployment uploads the static bundle and gallery screenshot to Windy with `private: false`. Anyone with the installation URL can use it, without contacting a server of ours. Windy staff must review and approve the plugin before it appears in the gallery.

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

The uploader uses the actual Git commit and repository metadata. It requires a clean working tree and packages only the three plugin files and gallery screenshot, with neutral archive ownership. It sends the API key only to Windy's official upload endpoint; the key is never embedded in the bundle.

The command prints the hosted installation URL and saves a receipt in `dist/publish-result.json`. Attach the resulting `dist/plugin.tar` to the matching GitHub release so its asset is the exact uploaded archive. Update the installation URL above for the new version. Install through Windy Plugins and confirm positions, tracks and favorites still work after a full reload with the local development server stopped.

### Gallery review

After the first public release is uploaded, post its hosted installation URL and source repository in [Windy’s finished plugins thread](https://community.windy.com/topic/31066/list-of-finished-windy-plugins-v42), asking staff to review and add it to the gallery. Use the `ggrwindy` developer account. Include a short feature summary and the disclosure that it was built using AI and OpenAI Codex. Setting `private: false` makes a release eligible; it does not grant approval automatically.

Keep the gallery screenshot current when the interface changes. Once approved, update the installation instructions above to lead with the gallery installation.

See [Windy's official publishing guide](https://docs.windy-plugins.com/getting-started/publishing-plugin.html) for account setup and gallery review.
