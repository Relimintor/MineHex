import { registerCeleronInputHandlers } from './celeron/celeronInput.js';

// YouTube mode uses celeron controls as a lightweight baseline.
// Keep this entry point separate so recording-specific input tweaks
// can be added without changing generic celeron behavior.
export function registerYoutubeInputHandlers() {
    registerCeleronInputHandlers();
}
