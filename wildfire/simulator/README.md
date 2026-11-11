# Fire-spread simulator

This directory contains the numerical engine used by the browser simulator.

## Current boundary

- `engine.js`: framework-free numerical core. It receives ignition, fuel, weather, terrain and moisture functions as inputs. It does not read the DOM, access Leaflet, fetch data or select a terrain provider.
- `index.html`: currently owns the map UI, scenario configuration, meteorology, terrain-provider integration, rendering and output formatting. It adapts those services to the numerical engine.

The engine API is exposed as `window.IrratiWildfireEngine` because the existing application is currently loaded through classic browser scripts. The UI delegates fuel-moisture response, spread behaviour, elliptical spread rate, Byram intensity, flame length and the time-stepped radial simulation to this module.

## Design rules

1. Keep the numerical engine deterministic for identical inputs.
2. Inject terrain and weather; never fetch them from the engine.
3. Keep units explicit: wind in km/h at the current adapter boundary, spread rate in m/min, angles in degrees, heat content in kJ/kg and moisture in percent.
4. Do not silently replace a selected terrain source. Missing samples must remain visible as missing/failed input.
5. Keep map drawing, DOM, exports and user interaction outside the numerical core.
6. Treat model output as an estimate, not an operational instruction or validated prediction.

## Next extraction steps

1. Separate terrain sampling into a provider-neutral interface and LiDAR/Terrarium adapters.
2. Move meteorology acquisition and normalization behind a weather-provider interface.
3. Move scenario state and validation into a scenario module.
4. Move map rendering, result presentation and exports into UI modules.
5. Add end-to-end tests for source provenance, coverage gaps, same-input scenario comparisons and reproducible outputs.

Run the numerical and provider tests with:

```bash
node --test wildfire/tests/*.test.mjs
```
