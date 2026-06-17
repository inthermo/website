# 🌍 Around the World — Country Quiz

A browser geography quiz to learn every country. No backend, no build step — static files on GitHub Pages.

## Levels
1. **Region · Multiple Choice** — pick continents, identify the highlighted country from 5 options.
2. **Region · Free Type** — same regions, type the name (typo-tolerant).
3. **World · Multiple Choice** — all countries, 5 options.
4. **World · Free Type** — all countries, randomized, type the name.

Tracks per-session **high score**, accuracy, best streak, and **answer speed** (a speed bonus + streak multiplier feed the score). Scores persist per level/region in `localStorage`.

## Data
- `countries.json` — 245 countries & territories (name, capital, continent, population, area, flag, languages). Built from the open [mledoze/countries](https://github.com/mledoze/countries) dataset + population figures.
- `geo.json` — country outlines from [Natural Earth](https://www.naturalearthdata.com/) (110m), keyed by ISO-A3. Countries without geometry render as a marker dot.
- `build.py` — regenerates both files from the source datasets.

## Run locally
```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

Map uses a simple equirectangular projection rendered to inline SVG; the view zooms to the active region's bounding box each question.
