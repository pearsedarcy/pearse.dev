---
title: cam-tests
slug: cam-tests
oneLiner: An FFmpeg test suite for HDMI capture cards — the groundwork for recording surgical stations reliably.
period: Aug 2025
role: Sole engineer
stack:
  - Python
  - FFmpeg
  - v4l2
featured: false
order: 12
features:
  - Enumerates capture devices and probes supported formats, resolutions and frame rates.
  - Records fixed-length samples per configuration and reports dropped frames.
hooks:
  - Written in the first weeks of wetlabs.app to pick capture hardware with evidence instead of spec sheets.
repo: https://github.com/pearsedarcy/cam-tests
visibility: public
category: tool
---

Before a video platform, you need to know which capture cards actually deliver the frames they promise. This small suite answered that question for the first wetlab stations.
