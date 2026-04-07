const BLOCK_AXIS_BITS = 21n;
const BLOCK_HEIGHT_BITS = 20n;
const CHUNK_AXIS_BITS = 26n;

const BLOCK_AXIS_BIAS = 1n << (BLOCK_AXIS_BITS - 1n);
const BLOCK_HEIGHT_BIAS = 1n << (BLOCK_HEIGHT_BITS - 1n);
const CHUNK_AXIS_BIAS = 1n << (CHUNK_AXIS_BITS - 1n);

const BLOCK_AXIS_MASK = (1n << BLOCK_AXIS_BITS) - 1n;
const BLOCK_HEIGHT_MASK = (1n << BLOCK_HEIGHT_BITS) - 1n;
const CHUNK_AXIS_MASK = (1n << CHUNK_AXIS_BITS) - 1n;

function packSigned(value, bits, bias) {
    const int = BigInt(Math.trunc(value));
    const min = -bias;
    const max = (1n << (bits - 1n)) - 1n;
    if (int < min || int > max) throw new RangeError(`Coordinate ${value} is outside packable range.`);
    return int + bias;
}

function unpackSigned(packed, bias) {
    return Number(packed - bias);
}

export function packBlockKey(q, r, h) {
    const pq = packSigned(q, BLOCK_AXIS_BITS, BLOCK_AXIS_BIAS);
    const pr = packSigned(r, BLOCK_AXIS_BITS, BLOCK_AXIS_BIAS);
    const ph = packSigned(h, BLOCK_HEIGHT_BITS, BLOCK_HEIGHT_BIAS);
    return (pq << (BLOCK_AXIS_BITS + BLOCK_HEIGHT_BITS)) | (pr << BLOCK_HEIGHT_BITS) | ph;
}

export function unpackBlockKey(key) {
    const normalized = normalizeBlockKey(key);
    const pq = (normalized >> (BLOCK_AXIS_BITS + BLOCK_HEIGHT_BITS)) & BLOCK_AXIS_MASK;
    const pr = (normalized >> BLOCK_HEIGHT_BITS) & BLOCK_AXIS_MASK;
    const ph = normalized & BLOCK_HEIGHT_MASK;
    return {
        q: unpackSigned(pq, BLOCK_AXIS_BIAS),
        r: unpackSigned(pr, BLOCK_AXIS_BIAS),
        h: unpackSigned(ph, BLOCK_HEIGHT_BIAS)
    };
}

export function packChunkKey(cq, cr) {
    const pq = packSigned(cq, CHUNK_AXIS_BITS, CHUNK_AXIS_BIAS);
    const pr = packSigned(cr, CHUNK_AXIS_BITS, CHUNK_AXIS_BIAS);
    return (pq << CHUNK_AXIS_BITS) | pr;
}

export function unpackChunkKey(key) {
    const normalized = normalizeChunkKey(key);
    const pq = (normalized >> CHUNK_AXIS_BITS) & CHUNK_AXIS_MASK;
    const pr = normalized & CHUNK_AXIS_MASK;
    return {
        cq: unpackSigned(pq, CHUNK_AXIS_BIAS),
        cr: unpackSigned(pr, CHUNK_AXIS_BIAS)
    };
}

export function packColumnKey(q, r) {
    return packChunkKey(q, r);
}

export function unpackColumnKey(key) {
    const { cq, cr } = unpackChunkKey(key);
    return { q: cq, r: cr };
}

export function blockKeyToString(key) {
    const { q, r, h } = unpackBlockKey(key);
    return `${q},${r},${h}`;
}

export function chunkKeyToString(key) {
    const { cq, cr } = unpackChunkKey(key);
    return `${cq},${cr}`;
}

export function normalizeBlockKey(key) {
    if (typeof key === 'bigint') return key;
    if (typeof key === 'number') return BigInt(Math.trunc(key));
    if (typeof key === 'string') {
        const [q, r, h] = key.split(',').map(Number);
        return packBlockKey(q, r, h);
    }
    throw new TypeError('Unsupported block key type');
}

export function normalizeChunkKey(key) {
    if (typeof key === 'bigint') return key;
    if (typeof key === 'number') return BigInt(Math.trunc(key));
    if (typeof key === 'string') {
        const [cq, cr] = key.split(',').map(Number);
        return packChunkKey(cq, cr);
    }
    throw new TypeError('Unsupported chunk key type');
}

export function normalizeColumnKey(key) {
    return normalizeChunkKey(key);
}
