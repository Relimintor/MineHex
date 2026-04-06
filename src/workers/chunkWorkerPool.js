export function createChunkWorkerPool({ workerSize, workerFactory, onMessage, onError }) {
    const workers = [];
    let roundRobinIndex = 0;

    const safeWorkerSize = Math.max(1, Math.floor(workerSize || 1));

    for (let index = 0; index < safeWorkerSize; index++) {
        const worker = workerFactory();
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', (error) => onError?.(error, index));
        workers.push(worker);
    }

    return {
        get size() {
            return workers.length;
        },
        postMessage(payload) {
            if (workers.length === 0) return false;
            const worker = workers[roundRobinIndex % workers.length];
            roundRobinIndex = (roundRobinIndex + 1) % workers.length;
            worker.postMessage(payload);
            return true;
        },
        terminate() {
            for (const worker of workers) worker.terminate();
            workers.length = 0;
            roundRobinIndex = 0;
        }
    };
}
