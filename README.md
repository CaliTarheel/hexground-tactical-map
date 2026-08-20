# Hexground

**Live site:** <https://hexground-tactical-map.srider.chatgpt.site/>

**Public source:** <https://github.com/CaliTarheel/hexground-tactical-map>

Hexground turns real-world locations into playable tactical hex boards inspired
by the terrain scale and vocabulary of the *Lock 'n Load Tactical* system. It
uses mapped buildings, roads, paths, trees, and sampled elevation to produce a
standard board with interactive controls and exportable artwork.

## Local development

Requires Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

Run `npm test` for the production build, map geometry tests, terrain tests, and
attribution checks.

## Data and trademarks

Map features are credited to OpenStreetMap contributors. Elevation data can come
from USGS 3DEP/NED, Mapzen/AWS Terrain Tiles, or Copernicus DEM. This independent
tool contains no game rules or art and is not affiliated with the system's
publisher.

## License and attribution

Copyright © 2026 Stephen G. Rider. The code is available under the MIT License.
If you reuse or customize it, keep the copyright and license notice and credit
Stephen G. Rider. Contact: <rider.sg@gmail.com>.
