---
title: MX Creative Keypad on Linux
slug: mx-creative-keypad
oneLiner: A Node service that turns the Logitech MX Creative Console keypad into a paged app launcher on Linux, where the vendor software does not exist.
period: Jul – Sep 2026
role: Sole engineer
stack:
  - Node.js
  - sharp
  - USB HID
featured: false
order: 11
features:
  - Pages of launcher keys with icons rendered to the LCD keypad via sharp.
  - Key press handling over USB HID with no vendor daemon.
hooks:
  - Built because the hardware was on the desk and the software was Windows-only.
visibility: private
category: tool
---

A small, satisfying reverse-engineering job: find the HID reports, render icons to the right pixel format, and give a nice piece of hardware a reason to exist on Linux.
