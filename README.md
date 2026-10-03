# The Kindle Gazette

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

## Configuration

Everything in `config.json` can also be changed from **Settings**:

| Key | Default | |
| --- | --- | --- |
| `title`, `motto` | The Kindle Gazette | Masthead text |
| `columns` | 2 | Front-page columns, 1–4. Use 2 for a 6–7″ Kindle in portrait and 3 for a Scribe or landscape. |
| `storiesPerPage` | 10 | Stories per newspaper page |
| `summaryLength` | 280 | Summary characters per brief (the lead gets twice as many) |
| `refreshMinutes` | 20 | How long feeds are cached |
| `maxPerFeed` | 30 | Newest stories kept per feed |
| `showImages` | false | Show pictures, fetched through the server |
| `feeds` | | `[{ "id", "name", "url", "enabled" }]` |

When you add a feed you can paste a website's address instead of the feed's. The server finds the feed through the site's `<link rel="alternate">` tag. You can also import feeds by pasting OPML or a list of URLs, and export them from `/opml`.

## How it handles the Kindle's limitations

| Limitation | What the app does |
| --- | --- |
| Old, slow browser engine. JavaScript is unreliable and there is no cross-origin fetch. | The server does all fetching and rendering. Pages contain no scripts at all, and the tests check for this. |
| Patchy CSS support | Columns are laid out with `<table>` and floats, with no flexbox or grid. Below 640px wide the columns stack into one through a simple media query. |
| E-ink ghosting, slow refresh and painful scrolling | Pages are paginated with large *Previous* / *Next* buttons. Articles are split into screen-sized pages at paragraph breaks, and the split depends on the text size. There are no animations, transitions or hover effects. |
| Low contrast between greys | Everything is pure black on white. Secondary text uses italics and small caps instead of grey. |
| Small memory and slow network | Each page is a single request of about 10–20 KB with inline CSS and no web fonts. Pictures are off by default. |
| Old TLS stack | When pictures are on, they go through `/img` on your server, so the Kindle only connects to one host. Only images that appear in the current feeds are proxied, so it is not an open proxy. |
| Imprecise touch | Buttons and links have large tap targets, and form controls are 16px or bigger. |
| Text size | Four sizes (A A A A in the footer) are remembered in a cookie. |
| Messy feed HTML | Content is reduced to a safe subset. Scripts, iframes, styles, event handlers, tracking pixels and share buttons are removed. |

Supported formats are RSS 2.0, RSS 1.0 (RDF) and Atom, including `content:encoded`, `media:*` thumbnails, enclosures and non-UTF-8 encodings. If a feed fails to update, the last good copy stays on the page with a notice.

## Pages

`/` front page · `/section/<id>` section · `/article/<id>` story · `/settings` · `/refresh` · `/opml`

## Development

```sh
npm test
```

The code is split into a few files:

* `lib/xml.js`: forgiving XML parser
* `lib/feeds.js`: fetching, parsing and caching
* `lib/sanitize.js`: HTML cleanup
* `lib/render.js`: all HTML and CSS
* `server.js`: routing
