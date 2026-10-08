# The Gazette

A self-hosted RSS reader that lays your feeds out as a classic broadsheet newspaper, with a masthead, a lead story, columns and section pages. It is built for the Kindle web browser.

* **No dependencies.** It needs Node.js 18 or newer and nothing else.
* **No JavaScript in the pages.** The server fetches and parses every feed and sends the Kindle plain HTML.
* **Configurable.** Add, rename, reorder, disable and remove feeds from the Settings page on the Kindle itself, or edit `config.json` directly.

## Running it

```sh
npm start                 # http://<your-computer>:8080/
PORT=3000 npm start       # another port
ADMIN_PASSWORD=secret npm start   # put a password on /settings
```

To read it on a Kindle, open **Experimental Browser** and go to `http://<computer-ip>:8080/`. Use the computer's LAN address, not `localhost`, and bookmark the page. Serving plain `http://` on your home network avoids the TLS problems older Kindles have with modern certificates. If you host it publicly, put it behind HTTPS and set `ADMIN_PASSWORD`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Address the server listens on |
| `CONFIG_PATH` | `./config.json` | Where feeds and settings are stored |
| `ADMIN_PASSWORD` | *(none)* | HTTP Basic password for `/settings` and `/opml` |
| `TZ` | system | Time zone used for datelines (for example `America/New_York`) |

## Hosting free on GitHub Pages

You don't need a server. A GitHub Actions job (`.github/workflows/pages.yml`) builds the whole paper as static HTML and publishes it to GitHub Pages: a new edition every hour, and right away on every push to `main`. GitHub's scheduler often runs late or skips runs, so an hour can occasionally be missed; the workflow wakes once an hour and publishes only when an edition is due (it checks the site's `edition.json`). To print at set times instead, change `EDITION_HOURS` in the workflow to local hours, e.g. `'6 18'` for 6 AM and 6 PM. The address will be `https://<user>.github.io/<repo>/`.

To turn it on:

1. Free GitHub Pages requires a **public** repository.
2. In the repo, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Go to **Actions → Publish newspaper → Run workflow**, or push any commit, to print the first edition.
4. Optional: the paper's time zone defaults to `America/New_York`. To change it, go to **Settings → Secrets and variables → Actions → Variables** and add `TZ`, for example `America/Chicago`. It sets the datelines, the edition times and when the issue number goes up.

Some things work differently in the static edition:

* **Changing feeds:** there's no Settings page. Edit `config.json` on GitHub; saving it publishes a new edition within a couple of minutes. To show an *Edit feeds* link in the footer, remove the `EDIT_URL: ''` line from the workflow.
* **Bylines** show the time each story was published, not "3 hrs ago", because a static page can't keep relative times current.
* **Editions:** the masthead names the Morning, Afternoon or Evening edition, and the footer says when it was printed and when the next one comes.
* **No text-size buttons or Refresh link.** Use the Kindle browser's own zoom. The footer's *Latest edition* link fetches the newest front page.
* **Browser caching:** GitHub Pages lets browsers keep a page for up to 10 minutes. Every link inside the paper carries the edition's stamp (`?e=…`), so links from a new edition always load fresh pages. Only a bookmarked front page can be up to 10 minutes old.
* **Pictures**, if enabled, load directly from the news sites.
* **Failed builds:** nothing is published, and the previous edition stays up, if every feed fails or `config.json` has a typo. A typo stops the build with an error pointing at the line. A single failed feed is just left out of that edition. Each run's page in the Actions tab lists every feed's result: stories loaded, how many name an author, any ads filtered, and each comic strip's size.
* **Paused schedules:** GitHub pauses scheduled jobs on a repo with no activity for 60 days. If that happens, open the Actions tab and click *Enable workflow*.

To build the static site locally, run `npm run build`. The output goes to `_site/`, and `BASE_PATH=/<repo>` sets the URL prefix.

## Configuration

Edit `config.json` (on GitHub for the hosted edition). When self-hosting, the Settings page also covers feeds (name, URL, enabled, front page) and the main newspaper options (title, motto, founding date, columns, stories per page, summary length, refresh time, stories per feed, pictures); the rest are `config.json` only.

| Key | Default | |
| --- | --- | --- |
| `title`, `motto` | The Kindle Gazette | Masthead text |
| `founded` | *(none)* | Founding date, `YYYY-MM-DD`. The masthead shows Vol. I, No. 1 on that day. The number goes up daily and each anniversary starts a new volume. Leave it out to hide the line. |
| `columns` | 2 | Front-page columns, 1–4. Use 2 for a 6–7″ Kindle in portrait and 3 for a Scribe or landscape. |
| `storiesPerPage` | 10 | Stories per newspaper page |
| `summaryLength` | 280 | Summary characters per brief (the lead gets twice as many) |
| `refreshMinutes` | 20 | How long feeds are cached |
| `maxPerFeed` | 30 | Newest stories kept per feed |
| `showImages` | false | Show pictures for news stories. Each one fills a fixed-size frame (larger for the lead story) so all pictures in a slot match. When self-hosting, pictures are fetched through the server. |
| `feeds` | | `[{ "id", "name", "url", "enabled", "frontPage" }]`. Each story's byline names its source (the feed's own title). Feeds with the same `name` are merged into one section, with their stories mixed by date. Set `"frontPage": false` on a feed to keep its stories off the front page; they still appear in their section. Each `id` must be unique. |
| feed `type`, `label` | `news` | Set `"type": "comic"` on a comic-strip feed. It then contributes only its latest strip, shown as an image even when `showImages` is off. A section made only of comic feeds is laid out as a funny pages, in the order the feeds are listed. `label` is the strip's name, such as `"Peanuts"`. The build measures each strip: wide daily strips get a full row, and squarer panels (single panels, Sunday pages) are paired two to a row at matching heights. |
| feed `showText` | false | Comic feeds only. `true` prints the feed's text for the strip, such as a caption or alt text, under the image. |
| `filterAds` | true | Drop advertisements from news feeds: sportsbook promo and bonus codes, shopping "deals" round-ups, coupons, and items labelled sponsored or paid. Betting coverage such as odds and picks is kept. Each build's summary lists what was filtered. |
| `exclude` | `[]` | More headline phrases to drop, e.g. `["waiver wire", "/^Quiz:/"]`. Plain text matches anywhere, ignoring case; `/…/` is a regular expression. |
| `maxAgeHours` | *(none)* | Front page only: show just the stories from the last N hours, for example `24`. Section pages still show everything (up to `maxPerFeed`). Undated stories are kept. |
| `comicMaxHeight` | 55 | Tallest a comic strip may be, as a % of the screen height. Lower it if Sunday strips are too big. |

When you add a feed you can paste a website's address instead of the feed's. The server finds the feed through the site's `<link rel="alternate">` tag. You can also import feeds by pasting OPML or a list of URLs, and export them from `/opml`.

## How it handles the Kindle's limitations

| Limitation | What the app does |
| --- | --- |
| Old, slow browser engine. JavaScript is unreliable and there is no cross-origin fetch. | The server does all fetching and rendering. Pages contain no scripts at all, and the tests check for this. |
| Patchy CSS support | Columns are laid out with `<table>` and floats, with no flexbox or grid. Below 640px wide the columns stack into one through a simple media query. |
| E-ink ghosting, slow refresh and painful scrolling | Pages are paginated with large *Previous* / *Next* buttons. Articles are split into screen-sized pages at paragraph breaks, and the split depends on the text size. There are no animations, transitions or hover effects. |
| Low contrast between greys | Everything is pure black on white. Secondary text uses italics and small caps instead of grey. |
| Small memory and slow network | Each page is a single request of about 10–20 KB with inline CSS and no web fonts. Pictures are off by default. |
| Old TLS stack | When self-hosting with pictures on, they go through `/img` on your server, so the Kindle only connects to one host. Only images that appear in the current feeds are proxied, so it is not an open proxy. |
| Imprecise touch | Buttons and links have large tap targets, and form controls are 16px or bigger. |
| Text size | When self-hosting, four sizes (A A A A in the footer) are remembered in a cookie. The static edition relies on the Kindle's own zoom. |
| Messy feed HTML | Content is reduced to a safe subset. Scripts, iframes, styles, event handlers, tracking pixels and share buttons are removed. |

Supported formats are RSS 2.0, RSS 1.0 (RDF) and Atom, including `content:encoded`, `media:*` thumbnails, enclosures and non-UTF-8 encodings. Some big sites turn away unknown apps, so a feed that is refused or comes back empty is retried once with ordinary browser headers. If it still fails, the error says what came back. When self-hosting, a feed that fails to update keeps its last good copy on the page with a notice.

## Pages

`/` front page · `/section/<id>` section · `/article/<id>` story · `/settings` · `/refresh` · `/opml` · `/img` (self-hosted image proxy). The static edition uses `/page/<n>/`, `/section/<id>/<n>/` and `/article/<id>/<n>/` for later pages, plus `edition.json`.

## Development

```sh
npm test
```

The code is split into a few files:

* `server.js`: the self-hosted server: routing, Settings page and image proxy
* `build.js`: the static build for GitHub Pages
* `lib/config.js`: loading and checking `config.json`, and grouping feeds into sections
* `lib/feeds.js`: fetching, parsing and caching feeds; merging sections; comics
* `lib/adfilter.js`: spotting advertisements in feeds
* `lib/xml.js`: forgiving XML parser
* `lib/sanitize.js`: HTML cleanup
* `lib/imagesize.js`: reading comic strip sizes from image headers
* `lib/render.js`: all HTML and CSS
* `lib/schedule.js` and `scripts/edition-due.js`: deciding when a scheduled edition is due
* `.github/workflows/pages.yml`: the hourly publishing job
