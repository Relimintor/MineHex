const CONTINENT_AMPLITUDE = 50;
const CONTINENT_FREQUENCY = 0.001;
const CONTINENT_OFFSET = 20;
const TERRAIN_MID_AMPLITUDE = 20;
const TERRAIN_MID_FREQUENCY = 0.01;
const TERRAIN_DETAIL_AMPLITUDE = 5;
const TERRAIN_DETAIL_FREQUENCY = 0.05;
const TEMPERATURE_FREQUENCY = 0.0005;
const MOISTURE_FREQUENCY = 0.0005;
const MOISTURE_OFFSET = 100;

const BLOCK_INDEX = {
    grass: 0,
    dirt: 1,
    water: 4,
    snow: 8,
    ice: 9
};

function hash2D(x, y, seed = 0) {
    const v = Math.sin((x * 127.1) + (y * 311.7) + (seed * 17.13)) * 43758.5453123;
    return v - Math.floor(v);
}

function smoothstep(t) {
    return t * t * (3 - (2 * t));
}

function valueNoise2D(x, y, seed = 0) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smoothstep(x - x0);
    const ty = smoothstep(y - y0);

    const n00 = hash2D(x0, y0, seed);
    const n10 = hash2D(x0 + 1, y0, seed);
    const n01 = hash2D(x0, y0 + 1, seed);
    const n11 = hash2D(x0 + 1, y0 + 1, seed);

    const nx0 = n00 + ((n10 - n00) * tx);
    const nx1 = n01 + ((n11 - n01) * tx);
    return ((nx0 + ((nx1 - nx0) * ty)) * 2) - 1;
}

function getHeight(q, r) {
    const continent = CONTINENT_AMPLITUDE * valueNoise2D(q * CONTINENT_FREQUENCY, r * CONTINENT_FREQUENCY, 1) - CONTINENT_OFFSET;
    const terrain = (TERRAIN_MID_AMPLITUDE * valueNoise2D(q * TERRAIN_MID_FREQUENCY, r * TERRAIN_MID_FREQUENCY, 2))
        + (TERRAIN_DETAIL_AMPLITUDE * valueNoise2D(q * TERRAIN_DETAIL_FREQUENCY, r * TERRAIN_DETAIL_FREQUENCY, 3));
    return continent + terrain;
}

function getSmoothedHeight(rawHeight) {
    return Math.round(Math.max(-40, Math.min(80, rawHeight)));
}

function getClimate(q, r) {
    return {
        temp: valueNoise2D(q * TEMPERATURE_FREQUENCY, r * TEMPERATURE_FREQUENCY, 4),
        moist: valueNoise2D((q * MOISTURE_FREQUENCY) + MOISTURE_OFFSET, (r * MOISTURE_FREQUENCY) + MOISTURE_OFFSET, 5)
    };
}

function getBiome(climate, height, seaLevel) {
    if (height < seaLevel) return 'ocean';
    if (height < seaLevel + 2) return 'beach';
    if (climate.temp < -0.4) return climate.moist > 0 ? 'snowy_forest' : 'snowy_plains';
    if (climate.moist > 0.45) return 'forest';
    return 'plains';
}

function buildChunkColumns({ cq, cr, chunkSize, nethrockLevel, seaLevel }) {
    const centerQ = cq * chunkSize;
    const centerR = cr * chunkSize;
    const columns = [];

    for (let q = -chunkSize; q <= chunkSize; q++) {
        for (let r = -chunkSize; r <= chunkSize; r++) {
            if (Math.abs(q + r) > chunkSize) continue;

            const absQ = centerQ + q;
            const absR = centerR + r;
            const climate = getClimate(absQ, absR);
            const height = getSmoothedHeight(getHeight(absQ, absR));
            const biome = getBiome(climate, height, seaLevel);
            const isSnowBiome = biome === 'snowy_plains' || biome === 'snowy_forest';
            const topBlockType = biome === 'beach'
                ? BLOCK_INDEX.dirt
                : (height < seaLevel ? BLOCK_INDEX.dirt : (isSnowBiome ? BLOCK_INDEX.snow : BLOCK_INDEX.grass));
            const addSurfaceFluid = biome === 'ocean';
            const surfaceFluidType = climate.temp < -0.6 ? BLOCK_INDEX.ice : BLOCK_INDEX.water;
            const addTree = biome === 'forest' ? 'forest' : (biome === 'snowy_forest' ? 'snow' : null);

            if (height < nethrockLevel + 1) continue;
            columns.push({
                q: absQ,
                r: absR,
                height,
                topBlockType,
                addSurfaceFluid,
                surfaceFluidType,
                addTree
            });
        }
    }

    return columns;
}

function packChunkColumns(columns) {
    const count = columns.length;
    const q = new Int32Array(count);
    const r = new Int32Array(count);
    const height = new Int32Array(count);
    const topBlockType = new Uint8Array(count);
    const surfaceFluidType = new Uint8Array(count);
    const flags = new Uint8Array(count);

    for (let i = 0; i < count; i++) {
        const column = columns[i];
        q[i] = column.q;
        r[i] = column.r;
        height[i] = column.height;
        topBlockType[i] = column.topBlockType;
        surfaceFluidType[i] = column.surfaceFluidType;

        let bits = 0;
        if (column.addSurfaceFluid) bits |= 1;
        if (column.addTree === 'forest') bits |= 2;
        if (column.addTree === 'snow') bits |= 4;
        flags[i] = bits;
    }

    return {
        count,
        qBuffer: q.buffer,
        rBuffer: r.buffer,
        heightBuffer: height.buffer,
        topBlockTypeBuffer: topBlockType.buffer,
        surfaceFluidTypeBuffer: surfaceFluidType.buffer,
        flagsBuffer: flags.buffer
    };
}

self.addEventListener('message', (event) => {
    if (event.data?.type !== 'generate') return;
    const { cq, cr, chunkSize, nethrockLevel, seaLevel } = event.data;
    const columns = buildChunkColumns({ cq, cr, chunkSize, nethrockLevel, seaLevel });
    const packed = packChunkColumns(columns);
    self.postMessage({
        chunkKey: `${cq},${cr}`,
        cq,
        cr,
        columns: packed
    }, [
        packed.qBuffer,
        packed.rBuffer,
        packed.heightBuffer,
        packed.topBlockTypeBuffer,
        packed.surfaceFluidTypeBuffer,
        packed.flagsBuffer
    ]);
});
