# Contributing to TextGlide

TextGlide is a small, focused open-source tool. Contributions are welcome — here's how to help.

---

## Ways to contribute

- **Bug reports** — open a GitHub Issue with a clear description, the EPUB you used (if shareable), your browser, and what you expected vs. what happened.
- **Feature suggestions** — open a GitHub Issue tagged `enhancement`. Describe the use case, not just the feature.
- **Code contributions** — fork the repo, make your changes on a branch, and open a Pull Request. See the PR process below.

---

## The algorithm change rule

The constants in `textglide_config.py` — gap character, minimum phrase length, minimum character thresholds, POS trigger sets — are calibrated to specific peer-reviewed papers, cited inline in that file. **Any change to algorithm constants or break logic must cite a peer-reviewed source.** Intuition and feel are not sufficient justification. If you believe a constant is wrong, open an Issue first and link the evidence.

---

## What not to propose

The following decisions are locked and will not be revisited without new empirical evidence:

- Reintroducing a Spacing Width slider (gap magnitude above a perceptible threshold has no significant effect — Bever et al. 1992)
- Reintroducing the em space (U+2003) — no empirical support; exceeded all tested gap magnitudes
- Adding a line-break chunking option — three independent papers show this is neutral to actively harmful (Keenan 1984; Coleman & Kim 1961; North & Jenkins 1951)
- Per-word bolding (Bionic Reading style) — a distinct cue type with separate evidence requirements; out of scope for this project

---

## PR process

1. Fork the repo and create a branch from `main`.
2. Make your changes. Keep commits focused and descriptive.
3. Add a `Signed-off-by: Your Name <your@email.com>` line to your commit message (DCO — no CLA required).
4. Open a Pull Request with a clear description of what changed and why.
5. For algorithm changes, include the paper citation in the PR description.

---

## Code style

Match the existing style of the file you're editing. No strict linter requirement for now — consistency over convention.

---

## License

By contributing, you agree your contributions will be licensed under the MIT License.
