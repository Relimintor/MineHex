const BLOCK_COORD_BITS = 21n;
const BLOCK_COORD_MASK = (1n << BLOCK_COORD_BITS) - 1n;
const BLOCK_COORD_OFFSET = 1 << 20;

function packSignedCoord(coord) {
    return BigInt(coord + BLOCK_COORD_OFFSET) & BLOCK_COORD_MASK;
}

function unpackSignedCoord(packedCoord) {
    return Number(packedCoord) - BLOCK_COORD_OFFSET;
}

export function packBlockKey(q, r, h) {
    const packedQ = packSignedCoord(q);
    const packedR = packSignedCoord(r);
    const packedH = packSignedCoord(h);
    return (packedQ << (BLOCK_COORD_BITS * 2n)) | (packedR << BLOCK_COORD_BITS) | packedH;
}

export function unpackBlockKey(key) {
    const packedQ = (key >> (BLOCK_COORD_BITS * 2n)) & BLOCK_COORD_MASK;
    const packedR = (key >> BLOCK_COORD_BITS) & BLOCK_COORD_MASK;
    const packedH = key & BLOCK_COORD_MASK;
    return {
        q: unpackSignedCoord(packedQ),
        r: unpackSignedCoord(packedR),
        h: unpackSignedCoord(packedH)
    };
}
