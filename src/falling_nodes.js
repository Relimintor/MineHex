const fallingNodes = [];

export function addFallingNode(node) {
    if (!node) return;
    fallingNodes.push(node);
}

export function tickFallingNodes() {
    // Reserved for upcoming falling-block/falling-entity simulation.
    // Intentionally left lightweight for now.
    return fallingNodes.length;
}

export function clearFallingNodes() {
    fallingNodes.length = 0;
}
