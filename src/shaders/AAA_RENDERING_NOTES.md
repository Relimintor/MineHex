# AAA Shader Notes

## 🧠 Big Picture: What "AAA shaders" really mean

At AAA level, the renderer is a physically-based, temporally stable, multi-pass system that approximates the rendering equation in real time.

Core goals:
- Light transport (direct + indirect)
- Material response (PBR/BRDF)
- Visibility (depth, shadows, ambient occlusion)
- Temporal stability (TAA, reprojection)
- Perceptual output (HDR → tonemapping)

## ⚙️ 1. The Rendering Equation (core foundation)

\[
L_o(x, \omega_o) = \int_{\Omega} f_r(x, \omega_i, \omega_o)\,L_i(x, \omega_i)\,(\omega_i \cdot n)\,d\omega_i
\]

This describes:
- Incoming light \(L_i\)
- Surface response \(f_r\) (BRDF)
- Outgoing light \(L_o\)

### 🚨 Real-time reality

You do not solve the integral exactly in rasterized real-time rendering. Instead, you approximate it with layered techniques:
- Rasterization (visibility)
- Shadow maps (occlusion)
- Screen-space techniques (e.g. SSAO, SSR)
- Probe/voxel-based GI (indirect light)
