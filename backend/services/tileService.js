
class TileService {
  constructor() {
    // Konstante za sve nivoe zoom-a
    this.TILE_CONFIGS = {
      // Zoom 0-5: Kontinenti - velike sekcije
      distant: {
        zoomRange: [0, 5],
        gridSize: 3,  // 3x3 = 9 sekcija na mapi
        videosPerTile: 2  // 2 reprezentativna snimka po sekciji
      },
      // Zoom 6-10: Zemlje/Regije - srednje sekcije
      regional: {
        zoomRange: [6, 10],
        gridSize: 6,  // 6x6 = 36 sekcija
        videosPerTile: 5  // Do 5 snimaka po sekciji
      },
      // Zoom 11+: Gradovi - male sekcije
      detailed: {
        zoomRange: [11, 20],
        gridSize: 12,  // 12x12 = 144 sekcije
        videosPerTile: null  // Svi snimci (nema ogranicenja)
      }
    };
  }

  //  Tile config na osnovu zoom nivoa
  getTileConfig(zoomLevel) {
    if (zoomLevel <= 5) return this.TILE_CONFIGS.distant;
    if (zoomLevel <= 10) return this.TILE_CONFIGS.regional;
    return this.TILE_CONFIGS.detailed;
  }

  /**
    //Konvertuj lat/lng u tile koordinate
     @param {number} lat - Latitude (-90 do 90)
     @param {number} lng - Longitude (-180 do 180)
     @param {number} gridSize - Broj sekcija po osi (3, 6 ili 12)
     @returns {object} - { tileX, tileY }
   */
  latLngToTile(lat, lng, gridSize) {
    // Normalizuj koordinate na 0-1
    const normalizedLat = (lat + 90) / 180;  // -90..90 → 0..1
    const normalizedLng = (lng + 180) / 360; // -180..180 → 0..1

    // Konvertuj u tile koordinate
    const tileX = Math.floor(normalizedLng * gridSize);
    const tileY = Math.floor(normalizedLat * gridSize);

    // Osiguraj da su u dozvoljenom opsegu
    return {
      tileX: Math.max(0, Math.min(tileX, gridSize - 1)),
      tileY: Math.max(0, Math.min(tileY, gridSize - 1))
    };
  }

  /**
     Pronađi sve tile-olve koji se preklapaju sa bounds
     @param {object} bounds - { minLat, maxLat, minLng, maxLng }
     @param {number} gridSize - Broj sekcija
     @returns {array} - Niz tile ID-a
   */
  getVisibleTiles(bounds, gridSize) {
    // Osiguraj da su bounds validni
    let minLat = bounds.minLat;
    let maxLat = bounds.maxLat;
    let minLng = bounds.minLng;
    let maxLng = bounds.maxLng;

    // Ako je mapa rotirana/wrapped
    if (maxLat < minLat) {
      [minLat, maxLat] = [maxLat, minLat];
    }

    // Padding
    const latPadding = Math.max(5, (maxLat - minLat) * 0.20);
    const lngPadding = Math.max(5, (maxLng - minLng) * 0.20);

    const expandedMinLat = Math.max(-90, minLat - latPadding);
    const expandedMaxLat = Math.min(90, maxLat + latPadding);
    const expandedMinLng = Math.max(-180, minLng - lngPadding);
    const expandedMaxLng = Math.min(180, maxLng + lngPadding);

    const topLeft = this.latLngToTile(expandedMaxLat, expandedMinLng, gridSize);
    const bottomRight = this.latLngToTile(expandedMinLat, expandedMaxLng, gridSize);

    const tiles = [];
    
    // Pronađi sve tile-ove u opsegu
    for (let x = topLeft.tileX; x <= bottomRight.tileX; x++) {
      for (let y = topLeft.tileY; y <= bottomRight.tileY; y++) {
        tiles.push(`${x}_${y}`);
      }
    }

    return tiles;
  }

  /**
   *  Grupisi  videe po tile-ovima
   * @param {array} videos - Niz videa sa location podatkom
   * @param {number} gridSize - Broj sekcija
   * @returns {object} - { tileId: [videos], ... }
   */
  groupVideosByTiles(videos, gridSize) {
    const tiles = {};

    videos.forEach(video => {
      if (!video.location) return;

      const { latitude, longitude } = video.location;
      const tile = this.latLngToTile(latitude, longitude, gridSize);
      const tileId = `${tile.tileX}_${tile.tileY}`;

      if (!tiles[tileId]) {
        tiles[tileId] = [];
      }
      tiles[tileId].push(video);
    });

    return tiles;
  }

  /**
   * Filtriraj videe - zadrzi samo reprezentativne za svaki tile
   * @param {object} tiles - Grupirani videi po tile-ovima
   * @param {number} videosPerTile - Koliko videa po tile-u (null = sve)
   * @returns {array} - Filtrirani niz videa
   */
  getRepresentativeVideos(tiles, videosPerTile) {
    const result = [];

    Object.keys(tiles).forEach(tileId => {
      const videosInTile = tiles[tileId];

      if (videosPerTile === null) {
        // Nema limitiranja - dodaj sve
        result.push(...videosInTile);
      } else {
        // Sortiraj po popularnosti (views + likes) 
        const sorted = videosInTile.sort((a, b) => {
          const popularityA = (a.views || 0) + (a.likes || 0);
          const popularityB = (b.views || 0) + (b.likes || 0);
          return popularityB - popularityA;
        });

        // Uzmi samo prvi N videa
        const toAdd = sorted.slice(0, videosPerTile);
        result.push(...toAdd);
      }
    });

    // Sortiraj finalni rezultat po popularnosti
    return result.sort((a, b) => {
      const popA = (a.views || 0) + (a.likes || 0);
      const popB = (b.views || 0) + (b.likes || 0);
      return popB - popA;
    });
  }

  /**
   * Ucitaj videe za tile sistem
   */
  getVideosForViewport(videos, bounds, zoomLevel) {
    // Dobij konfiguraciju za zoom nivo
    const config = this.getTileConfig(zoomLevel);

    // Pronađi vidljive tile-ove
    const visibleTiles = this.getVisibleTiles(bounds, config.gridSize);

    // Grupiraj videe po tile-ovima
    const groupedVideos = this.groupVideosByTiles(videos, config.gridSize);

    // Filtriraj samo vidljive tile-ove
    const filteredTiles = {};
    visibleTiles.forEach(tileId => {
      if (groupedVideos[tileId]) {
        filteredTiles[tileId] = groupedVideos[tileId];
      }
    });

    // Dobij reprezentativne videe
    const result = this.getRepresentativeVideos(
      filteredTiles,
      config.videosPerTile
    );

    return {
      videos: result,
      count: result.length,
      zoomLevel,
      config: {
        gridSize: config.gridSize,
        videosPerTile: config.videosPerTile,
        totalTiles: config.gridSize * config.gridSize,
        visibleTiles: visibleTiles.length
      }
    };
  }
}

module.exports = new TileService();
