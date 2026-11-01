# Changelog

## 0.0.3 (2026-11-01)

### Sessions run on the pitwall daemon by default

aide now starts sessions in pitwall's daemon instead of its own main process.
They keep running when you close aide or restart the machine, and they resume
where they left off.

- A fresh install uses the daemon. If pitwall is not installed, aide shows how
  to install it, with a "Use built-in sessions" button to keep working without
  it.
- An existing install switches to the daemon too and shows a notice once. Your
  earlier sessions stay saved in aide's built-in backend.
- To go back, switch off "Run sessions on the pitwall daemon" in Settings >
  General, or press "Switch back to built-in" on the notice. The built-in
  backend stays for one more release.
