import { updateCinematicMaterialResponse } from './materials.js';

const THREE = window.THREE;

function saturate(v) {
    return THREE.MathUtils.clamp(v, 0, 1);
}

function smoothWindow(value, start, end) {
    if (end <= start) return 0;
    return saturate((value - start) / (end - start));
}

export function applySceneLighting(scene) {
    const ambient = new THREE.AmbientLight(0xdde7ff, 0.18);
    scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0xa9c9ff, 0x2a313a, 0.11);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff4d8, 1.0);
    sun.position.set(50, 100, 50);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 2;
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.02;
    sun.shadow.camera.near = 16;
    sun.shadow.camera.far = 420;
    sun.shadow.camera.left = -180;
    sun.shadow.camera.right = 180;
    sun.shadow.camera.top = 180;
    sun.shadow.camera.bottom = -180;
    scene.add(sun);

    // Adds cold moon key light so water/ice specular can read at night.
    const moon = new THREE.DirectionalLight(0xaecdff, 0.0);
    moon.position.set(-40, 90, -40);
    scene.add(moon);

    return {
        ambient,
        hemi,
        sun,
        moon,
        syncSun(skyValues) {
            if (!skyValues) return;
            const { sunDir, sunEnergy, dayFactor } = skyValues;
            const eventMoments = skyValues.eventMoments ?? {};
            const thunderFlash = saturate(eventMoments.thunderFlash ?? 0);
            const bloodMoonBoost = saturate(eventMoments.bloodMoonBoost ?? 0);
            const auroraStrength = saturate(eventMoments.auroraStrength ?? 0);
            const day = saturate(dayFactor);
            const night = 1 - day;
            const horizon = 1 - saturate(Math.abs(sunDir.y) / 0.42);

            // Separate warm windows for dawn and dusk to push contrast in transition moments.
            const dawnWindow = smoothWindow(sunDir.y, -0.22, 0.10) * smoothWindow(-sunDir.y, -0.08, 0.22);
            const duskWindow = smoothWindow(-sunDir.y, -0.22, 0.10) * smoothWindow(sunDir.y, -0.08, 0.22);
            const transitionWindow = Math.max(dawnWindow, duskWindow) * (0.45 + 0.55 * horizon);
            const goldenHour = transitionWindow * (0.6 + 0.4 * saturate(sunEnergy + 0.15));

            const posScale = 190;
            sun.position.set(sunDir.x * posScale, Math.max(8, sunDir.y * posScale), sunDir.z * posScale);

            // Stronger direct key at low sun angle for cinematic rim-light silhouettes.
            sun.intensity = (0.05 + sunEnergy * 1.45) + (goldenHour * 0.9) + (thunderFlash * 0.25);

            // Cooler nighttime ambient and stronger dawn/dusk contrast against direct light.
            const ambientNight = 0.05;
            const ambientDay = 0.22;
            ambient.intensity = THREE.MathUtils.lerp(ambientNight, ambientDay, day) - (transitionWindow * 0.025) + (thunderFlash * 0.12) + (auroraStrength * 0.04);
            hemi.intensity = THREE.MathUtils.lerp(0.085, 0.21, day) - (transitionWindow * 0.03) + (thunderFlash * 0.09) + (auroraStrength * 0.08);

            // Warm sun tint during golden hour.
            const warmBoost = goldenHour * (0.55 + 0.45 * horizon);
            sun.color.setRGB(
                1.0,
                0.8 + day * 0.17 + warmBoost * 0.1,
                0.62 + day * 0.26 + warmBoost * 0.22
            );

            // Push cool ambience at night.
            const nightBlue = THREE.MathUtils.smoothstep(night, 0.35, 1.0);
            hemi.color.setRGB(
                0.5 + day * 0.38 + (thunderFlash * 0.06),
                0.58 + day * 0.29 + nightBlue * 0.02 + (auroraStrength * 0.03) + (thunderFlash * 0.04),
                0.72 + day * 0.16 + nightBlue * 0.16 + (auroraStrength * 0.12) + (thunderFlash * 0.1)
            );
            hemi.groundColor.setRGB(
                0.08 + day * 0.2,
                0.1 + day * 0.16,
                0.14 + day * 0.14 + nightBlue * 0.08
            );

            // Moon key light (opposite side of sun) to enhance water/ice night highlights.
            const moonDir = new THREE.Vector3(-sunDir.x, Math.max(0.06, -sunDir.y * 0.9 + 0.12), -sunDir.z).normalize();
            moon.position.set(moonDir.x * posScale, moonDir.y * posScale, moonDir.z * posScale);
            moon.intensity = THREE.MathUtils.smoothstep(night, 0.4, 1.0) * (0.42 + (bloodMoonBoost * 0.2));
            moon.color.setRGB(
                0.69 + (bloodMoonBoost * 0.22),
                0.79 - (bloodMoonBoost * 0.51),
                1.0 - (bloodMoonBoost * 0.72)
            );

            updateCinematicMaterialResponse({ dayFactor: day, rainStrength: 0 });
        },
    };
}
