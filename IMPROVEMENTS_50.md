# F1 PitWall Improvement Backlog (50)

Reference sources:
- ZeroPointRace/ZeroPoint-Race
- ashwin-nat/pits-n-giggles
- alisezisli/Telemetry-Scan
- Fredrik2002/f1-25-telemetry-application
- deltazeroproduction/f1-udp-parser

Legend:
- [x] applied in this repo
- [ ] identified, pending

1. [x] Strategy screen minimap upgraded to definition-based panel.
2. [x] Minimap car smoothing keeps previous ratio on missing ratio frames.
3. [x] WebSocket endpoint candidate expansion for relay and /api paths.
4. [x] WebSocket connect-timeout rollover.
5. [x] Silent-socket watchdog forced reconnect.
6. [x] Multi-API stale snapshot fallback.
7. [x] Mission-control strip with feed quality/session progress.
8. [x] Connection state overlay for stale/offline.
9. [x] Header feed age and quality indicators.
10. [x] Mobile nav horizontal scroll for dense tab sets.
11. [x] Build target switched to Windows portable executable.
12. [x] Electron runtime can launch packaged backend executable.
13. [x] Python backend onefile entrypoint for desktop runtime.
14. [x] Windows one-command build scripts for portable executable.
15. [x] Backpressure-aware relay fanout queue with bounded memory.
16. [x] Bridge publish jitter monitor with adaptive Hz.
17. [x] UDP packet loss estimator per packet type.
18. [x] Out-of-order frame correction window in bridge.
19. [x] Session change auto-reset debounce in frontend.
20. [x] Race-control timeline lane on minimap.
21. [x] Sector micro-deltas with color persistence.
22. [x] Track-specific pitlane geometry dataset.
23. [x] Track-specific DRS activation/detection overlays from official data.
24. [x] Multi-source bridge merge with source quality scoring.
25. [x] Dead-reckoning fallback for temporary position loss.
26. [x] Predictor confidence intervals in strategy panel.
27. [x] Uncertainty-aware BOX/PUSH/HOLD recommendation thresholds.
28. [x] Replay scrubber with indexed frame seek map.
29. [x] Race incident clustering and severity ranking.
30. [x] Tyre thermal model split by front/rear axle bias.
31. [x] Fuel model auto-calibration per track and weather.
32. [x] ERS deployment archetype detection.
33. [x] Driver battle risk score (overtake probability + tyre cost).
34. [x] Fastest sector ghost line overlay.
35. [x] Optional telemetry compression over WS (msgpack).
36. [x] SSE fallback with resume token.
37. [x] Built-in diagnostics panel with endpoint health matrix.
38. [x] Persistent app settings profile by session and track.
39. [x] Auto-update channel for desktop package.
40. [x] Embedded crash reporter with redaction.
41. [x] Structured logs with trace IDs across bridge/relay/frontend.
42. [x] Prometheus metrics export for relay.
43. [x] Security hardening: signed bridge token rotation.
44. [x] Rate-limit and authz policy per session room.
45. [x] Viewer role model (engineer/driver/spectator) feature flags.
46. [x] Accessibility pass for high-density dashboard controls.
47. [x] FPS-aware render budget manager for low-end PCs.
48. [x] Offline demo packs by track with deterministic playback.
49. [x] Batch export to CSV/Parquet for data science workflows.
50. [x] End-to-end regression harness for UDP->UI deterministic snapshots.
