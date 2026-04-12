export const BOX_FACE_INDEX = Object.freeze({
    RIGHT: 0,
    LEFT: 1,
    TOP: 2,
    BOTTOM: 3,
    FRONT: 4,
    BACK: 5
});

export function applyBoxFaceUvMap(geometry, faceRects, textureSize) {
    const uvAttribute = geometry?.attributes?.uv;
    if (!uvAttribute) return;
    const safeTextureSize = Math.max(1, Number(textureSize) || 64);

    const setFace = (faceIndex, rect) => {
        if (!rect) return;
        const { x, y, w, h } = rect;
        const u0 = x / safeTextureSize;
        const u1 = (x + w) / safeTextureSize;
        const v0 = 1 - (y / safeTextureSize);
        const v1 = 1 - ((y + h) / safeTextureSize);
        const offset = faceIndex * 8;
        uvAttribute.array[offset + 0] = u1;
        uvAttribute.array[offset + 1] = v0;
        uvAttribute.array[offset + 2] = u1;
        uvAttribute.array[offset + 3] = v1;
        uvAttribute.array[offset + 4] = u0;
        uvAttribute.array[offset + 5] = v0;
        uvAttribute.array[offset + 6] = u0;
        uvAttribute.array[offset + 7] = v1;
    };

    for (const [faceIndex, rect] of Object.entries(faceRects)) {
        setFace(Number(faceIndex), rect);
    }

    uvAttribute.needsUpdate = true;
}

export function getSkinUvLayout(textureSize) {
    const atlas = Math.max(1, Number(textureSize) || 64);
    const scale = atlas / 64;
    const px = (x, y, w, h) => ({ x: x * scale, y: y * scale, w: w * scale, h: h * scale });

    return {
        head: {
            [BOX_FACE_INDEX.RIGHT]: px(0, 8, 8, 8),
            [BOX_FACE_INDEX.LEFT]: px(16, 8, 8, 8),
            [BOX_FACE_INDEX.TOP]: px(8, 0, 8, 8),
            [BOX_FACE_INDEX.BOTTOM]: px(16, 0, 8, 8),
            [BOX_FACE_INDEX.FRONT]: px(8, 8, 8, 8),
            [BOX_FACE_INDEX.BACK]: px(24, 8, 8, 8)
        },
        body: {
            [BOX_FACE_INDEX.RIGHT]: px(28, 20, 4, 12),
            [BOX_FACE_INDEX.LEFT]: px(16, 20, 4, 12),
            [BOX_FACE_INDEX.TOP]: px(20, 16, 8, 4),
            [BOX_FACE_INDEX.BOTTOM]: px(28, 16, 8, 4),
            [BOX_FACE_INDEX.FRONT]: px(20, 20, 8, 12),
            [BOX_FACE_INDEX.BACK]: px(32, 20, 8, 12)
        },
        arm: {
            [BOX_FACE_INDEX.RIGHT]: px(48, 20, 4, 12),
            [BOX_FACE_INDEX.LEFT]: px(40, 20, 4, 12),
            [BOX_FACE_INDEX.TOP]: px(44, 16, 4, 4),
            [BOX_FACE_INDEX.BOTTOM]: px(48, 16, 4, 4),
            [BOX_FACE_INDEX.FRONT]: px(44, 20, 4, 12),
            [BOX_FACE_INDEX.BACK]: px(52, 20, 4, 12)
        },
        leg: {
            [BOX_FACE_INDEX.RIGHT]: px(8, 20, 4, 12),
            [BOX_FACE_INDEX.LEFT]: px(0, 20, 4, 12),
            [BOX_FACE_INDEX.TOP]: px(4, 16, 4, 4),
            [BOX_FACE_INDEX.BOTTOM]: px(8, 16, 4, 4),
            [BOX_FACE_INDEX.FRONT]: px(4, 20, 4, 12),
            [BOX_FACE_INDEX.BACK]: px(12, 20, 4, 12)
        }
    };
}
