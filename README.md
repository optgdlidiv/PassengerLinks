# Passenger Rake Links — Delhi Division

Static dashboard (HTML + CSS + JS) for passenger train rake links, built for GitHub Pages.

## Files
- `index.html` — page layout
- `css/style.css` — styling (light and dark)
- `js/model.js` — time maths, rake-cycle chaining, rake position at any time
- `js/app.js` — map (Leaflet), 24-hour rake cycle chart, services table, station board, clock
- `data/links.json` — rake links from `passenger_link_Rake.xlsx` (one entry per link)
- `data/stations.json` — station positions (approximate) and the stations each route line is drawn through

## Adding a link
Add an object to `links` in `data/links.json` (same shape as Link 01), and add any new station codes and route paths to `data/stations.json`. Rakes are worked out automatically by chaining each arrival to the next departure from the same station.

## Running locally
The page loads JSON with `fetch`, so open it through a web server, not by double-clicking:
`python3 -m http.server` then open http://localhost:8000
